import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import * as messages from './messages';

/**
 * Property tests for the Player_Stats_Feature's fixed user-facing copy, placed
 * beside the module they cover as the design's Testing Strategy asks, and
 * running well above the 100-iteration floor (Requirement 14.5).
 *
 * `messages.ts` declares constants, so what is testable here is not behaviour
 * but the *shape* of the copy — and that shape is load-bearing. Three of the
 * design's numbered properties rest on it, and none of the three is claimed
 * here:
 *
 *  - **Property 18** claims the four Rating_Conditions are mutually
 *    distinguishable in rendered text and in accessible name (7.6). Whether the
 *    screen reaches for the right label is a rendering claim its own test
 *    carries; whether the three non-numeric labels *could* be told apart, and
 *    whether any of them asserts a number it has no business asserting, is a
 *    claim about the strings and is settled here.
 *  - **Property 26** claims the Tracking_Disabled_Condition and the
 *    Tracking_Empty_Condition are never presented as one another (11.1, 11.2,
 *    11.6). The mapping from a Rich_Stats block to a condition is
 *    `resolveRichCondition`'s; that the two statements differ is a claim about
 *    the strings.
 *  - **Property 39** claims the four player-list bands are mutually
 *    distinguishable (17.1, 17.2). It lands on the squads feature's own copy,
 *    but it shares this feature's four-condition vocabulary, so the same
 *    string-level rules are stated for this module's labels.
 *
 * What this file adds is the part of each that a rendered test cannot reach,
 * plus the "a property test adjacent to every module of the pure logic
 * directory" scan for `messages.ts` (Requirement 14.5).
 *
 * The exported set is read **dynamically** through a namespace import rather
 * than named one by one. That is the point of the file: a string added to the
 * module next month is covered without anyone remembering to list it here, so
 * the no-interpolation rule applies to copy that does not exist yet
 * (Requirements 3.7, 4.2).
 *
 * The detectors below are deliberately test-local and are themselves put under
 * property test in the last block. A detector that returned `false` for
 * everything would let all of this pass silently, so each is fed generated
 * strings that *do* carry the thing it looks for, exactly as
 * `identifiers.property.test.ts` checks its oracle against a defect at a time.
 */

// --- the exported set, read dynamically --------------------------------------

/**
 * Every export of the module, by name, read through the namespace object so a
 * later-added string is covered without a change here.
 */
const messageEntries: readonly (readonly [string, unknown])[] = Object.entries(messages);

/** Any export of the module: name and value together, so a failure names it. */
const messageEntryArb: fc.Arbitrary<readonly [string, unknown]> =
  fc.constantFrom(...messageEntries);

/**
 * Asserts an export is a plain string and yields it.
 *
 * The type check is part of the invariant rather than a convenience: the
 * module's mechanism for keeping a squad identity, a membership identity, a
 * Player_Display_Name, or any part of a rejected response body out of a message
 * is that no message is a function taking a parameter (Requirements 3.7, 4.2).
 * An export that turned into a template function would fail here rather than
 * quietly gain a seam.
 */
function messageText(entry: readonly [string, unknown]): string {
  const [name, value] = entry;

  expect(typeof value, `${name} must be exported as a plain string`).toBe('string');

  return value as string;
}

// --- detectors ----------------------------------------------------------------

/**
 * The characters through which an interpolation would have to pass: `${…}` and a
 * template literal, `{0}` and `{name}` positional and named forms.
 */
const INTERPOLATION_CHARACTERS = ['{', '}', '$'] as const;

/** The interpolation characters a text carries, in the order they appear. */
function interpolationCharactersIn(text: string): readonly string[] {
  return [...text].filter((character) =>
    (INTERPOLATION_CHARACTERS as readonly string[]).includes(character),
  );
}

/**
 * Placeholder forms other than the brace and dollar ones: `printf`-style `%s`
 * and `%1$d`, router-style `:membershipId`, an angle-bracketed slot, and the
 * doubled-bracket form some formatters use.
 *
 * Checked over every export rather than only the non-disclosing ones, because
 * the rule being kept is that *no* message takes a value — the rendered name of
 * a player is composed beside a label, never folded into one (Requirement 4.2).
 */
const PLACEHOLDER_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['printf-style', /%[-+ 0#]*\d*(?:\.\d+)?[sdifgeoxXucpn@]/],
  ['positional', /%\d/],
  ['router-style', /:[A-Za-z_]\w*/],
  ['angle-bracketed', /<[^<>]+>/],
  ['double-bracket', /\[\[|\]\]/],
];

/** The names of the placeholder forms a text carries. */
function placeholderFormsIn(text: string): readonly string[] {
  return PLACEHOLDER_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name,
  );
}

/**
 * The digit characters a text carries.
 *
 * Both the ASCII range and every Unicode decimal digit are looked for: a status
 * code, a count, or a rating reaching one of these strings is the thing being
 * ruled out, and it would be no less a disclosure spelled in Arabic-Indic
 * digits.
 */
function digitsIn(text: string): readonly string[] {
  return [...text].filter(
    (character) => /[0-9]/.test(character) || /\p{Nd}/u.test(character),
  );
}

/**
 * The nouns through which a message would name a squad or a membership.
 *
 * Scoped narrowly and deliberately. The squads feature's analogous test bans
 * `player` and `invite` outright as well, but that detector cannot be carried
 * across unchanged: Requirement 3.5 obliges the Not_Found_Treatment to state
 * *that the player was not found*, so the word is required there. The rule this
 * feature keeps is the one the requirements actually state — a message names
 * neither the squad identity nor the membership identity (Requirements 3.6,
 * 3.7, 4.2) — which is about carrying an *identity*, not about avoiding a
 * common noun.
 *
 * Matched on word boundaries rather than as substrings, so `remember` is not
 * read as `member` while `squads` and `squad's` both are.
 */
const IDENTITY_NOUN_PATTERN = /\b(?:squads?|members?|memberships?)\b/gi;

/** The squad and membership nouns a text carries, in any letter case. */
function identityNounsIn(text: string): readonly string[] {
  return [...text.matchAll(IDENTITY_NOUN_PATTERN)].map((match) => match[0]);
}

/**
 * The shapes an identity *value* takes if one ever reaches the copy: the
 * hyphenated 36-character form the route and the wire both use, and the
 * unhyphenated 32-digit form.
 *
 * Belt and braces beside the digit check, which already excludes most of these
 * — but an identity is the specific disclosure the requirements name, so it is
 * looked for by its own shape rather than inferred from the absence of digits.
 * Both patterns demand a digit somewhere, so an ordinary English word built only
 * from `a` to `f` cannot trip them.
 */
const IDENTITY_SHAPE_PATTERNS: readonly (readonly [string, RegExp])[] = [
  [
    'hyphenated identity',
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  ],
  ['unhyphenated identity', /(?=[0-9a-f]{32})(?=[a-f]*[0-9])[0-9a-f]{32}/i],
];

/** The names of the identity shapes a text carries. */
function identityShapesIn(text: string): readonly string[] {
  return IDENTITY_SHAPE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name,
  );
}

/**
 * The strings the non-disclosure rules bind, read from the module by name
 * because each is named by a requirement.
 *
 *  - {@link messages.GENERIC_PROFILE_FAILURE} is the one message rendered for a
 *    transport failure, a lapsed Profile_Call_Timeout, and a rejected body
 *    alike, so no digit of a status code and no identity may appear in it
 *    (Requirements 3.7, 4.2).
 *  - The Not_Found_Treatment's heading and statement conceal five causes behind
 *    one presentation, and the heading names neither identity nor any
 *    Player_Display_Name (Requirements 3.5, 3.6).
 *  - The three non-numeric Rating_Condition labels stand *in place of* a
 *    Display_Rating, so a digit in one of them would be the rating the
 *    condition says does not exist (Requirements 7.3, 7.4, 7.5).
 */
const NON_DISCLOSURE_MESSAGES: readonly (readonly [string, string])[] = [
  ['GENERIC_PROFILE_FAILURE', messages.GENERIC_PROFILE_FAILURE],
  ['NOT_FOUND_TREATMENT_HEADING', messages.NOT_FOUND_TREATMENT_HEADING],
  ['NOT_FOUND_TREATMENT_STATEMENT', messages.NOT_FOUND_TREATMENT_STATEMENT],
  ['RATING_PROVISIONAL', messages.RATING_PROVISIONAL],
  ['RATING_NEVER_PLAYED', messages.RATING_NEVER_PLAYED],
  ['RATING_ABSENT', messages.RATING_ABSENT],
];

const nonDisclosureMessageArb: fc.Arbitrary<readonly [string, string]> =
  fc.constantFrom(...NON_DISCLOSURE_MESSAGES);

/** The three non-numeric Rating_Condition labels, in the order of Requirement 7. */
const RATING_CONDITION_LABELS: readonly (readonly [string, string])[] = [
  ['RATING_PROVISIONAL', messages.RATING_PROVISIONAL],
  ['RATING_NEVER_PLAYED', messages.RATING_NEVER_PLAYED],
  ['RATING_ABSENT', messages.RATING_ABSENT],
];

// --- generators: strings that do carry what a detector looks for --------------

/** Text either side of an injected fragment, including the empty string. */
const surroundingTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 24 }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      'Rating still settling',
      'No rating recorded',
      'Something went wrong just now. Please try again.',
      'This player was not found, or they are not available to you.',
    ),
  },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', minLength: 0, maxLength: 16 }) },
);

/**
 * Injects `injected` into `text` at `position`, clamped into range — the shape of
 * a string that carries the injected fragment somewhere unpredictable.
 */
function inject(text: string, injected: string, position: number): string {
  const characters = [...text];
  const at = characters.length === 0 ? 0 : position % (characters.length + 1);

  return [...characters.slice(0, at), injected, ...characters.slice(at)].join('');
}

const injectionArb = (
  injectedArb: fc.Arbitrary<string>,
): fc.Arbitrary<{ readonly text: string; readonly injected: string }> =>
  fc
    .tuple(surroundingTextArb, injectedArb, fc.nat())
    .map(([text, injected, position]) => ({
      text: inject(text, injected, position),
      injected,
    }));

/** Every character the interpolation detector looks for. */
const interpolationCharacterArb = fc.constantFrom(...INTERPOLATION_CHARACTERS);

/** ASCII digits plus a sample of non-ASCII decimal digits. */
const digitCharacterArb = fc.constantFrom(
  ...'0123456789'.split(''),
  '\u0660', // Arabic-Indic zero
  '\u06f5', // Extended Arabic-Indic five
  '\u0967', // Devanagari one
  '\uff19', // fullwidth nine
);

/** Each squad and membership noun, in each letter case a writer might use. */
const identityNounArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(
      'squad',
      'squads',
      "squad's",
      'member',
      'members',
      'membership',
      'memberships',
    ),
    fc.constantFrom('lower' as const, 'upper' as const, 'title' as const),
  )
  .map(([noun, letterCase]) => {
    if (letterCase === 'upper') {
      return noun.toUpperCase();
    }

    if (letterCase === 'title') {
      return noun.charAt(0).toUpperCase() + noun.slice(1);
    }

    return noun;
  });

const hexDigitArb = fc.constantFrom(...'0123456789abcdef'.split(''));

const hexRun = (length: number): fc.Arbitrary<string> =>
  fc.string({ unit: hexDigitArb, minLength: length, maxLength: length });

/** A well-formed identity in both the hyphenated and the unhyphenated form. */
const identityValueArb: fc.Arbitrary<string> = fc
  .tuple(hexRun(8), hexRun(4), hexRun(4), hexRun(4), hexRun(12), fc.boolean())
  .map(([a, b, c, d, e, hyphenated]) => {
    const identity = `${a}-${b}-${c}-${d}-${e}`;

    // The unhyphenated form is given a digit so the shape detector's "not a word"
    // guard is satisfied, which is exactly the condition it claims to hold.
    return hyphenated ? identity : `0${`${a}${b}${c}${d}${e}`.slice(1)}`;
  });

// Feature: web-player-stats-screen, supports Properties 18, 26, and 39: every
// fixed message is a non-empty plain string carrying no interpolation seam
// Validates: Requirements 3.7, 4.2, 14.5
describe('messages — every export is a non-empty string with no interpolation seam', () => {
  it('exports a non-empty string, free of leading and trailing whitespace', () => {
    fc.assert(
      fc.property(messageEntryArb, (entry) => {
        const [name] = entry;
        const text = messageText(entry);

        // Empty copy is a blank space where an outcome should be: a person would
        // read a failed call as a successful one, and an absent rating as a
        // rating of nothing. Stray edge whitespace is the same defect in
        // miniature, since these strings are rendered exactly as declared.
        expect(text.length, `${name} must not be empty`).toBeGreaterThan(0);
        expect(text.trim(), `${name} must not be whitespace-only`).not.toBe('');
        expect(text, `${name} must carry no edge whitespace`).toBe(text.trim());
      }),
      { numRuns: 300 },
    );
  });

  it('carries no interpolation token: no brace and no dollar', () => {
    fc.assert(
      fc.property(messageEntryArb, (entry) => {
        const [name] = entry;
        const text = messageText(entry);

        // The absence of the parameter is the mechanism by which a squad
        // identity, a membership identity, a Player_Display_Name, a status code,
        // or a value from a rejected response body cannot reach a message
        // (Requirements 3.7, 4.2). A `${…}` left in a template, or a `{0}`
        // awaiting a formatter, would be that seam reappearing — so the
        // characters it would need are absent rather than merely unused.
        expect(
          interpolationCharactersIn(text),
          `${name} must carry no interpolation token`,
        ).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('carries no placeholder of any other form a formatter could fill', () => {
    fc.assert(
      fc.property(messageEntryArb, (entry) => {
        const [name] = entry;
        const text = messageText(entry);

        // Beyond the brace and dollar forms: a `printf` conversion, a positional
        // `%1`, a router-style `:membershipId`, or an angle-bracketed slot would
        // each be a seam through which a value the requirements exclude could
        // still arrive (Requirements 3.7, 4.2).
        expect(placeholderFormsIn(text), `${name} must carry no placeholder`).toEqual(
          [],
        );
      }),
      { numRuns: 300 },
    );
  });

  it('carries no identity value in either transmitted form', () => {
    fc.assert(
      fc.property(messageEntryArb, (entry) => {
        const [name] = entry;
        const text = messageText(entry);

        // Nothing should be able to put an identity in a constant, but the
        // disclosure the requirements name is exactly this one, so it is looked
        // for directly rather than left to the interpolation check (3.6, 3.7).
        expect(identityShapesIn(text), `${name} must carry no identity`).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic: reading an export twice yields the same string', () => {
    fc.assert(
      fc.property(messageEntryArb, (entry) => {
        const [name, value] = entry;
        const read = (): unknown => messages[name as keyof typeof messages];

        // Constants, not getters: a message that varied between reads could not
        // be the single Generic_Profile_Failure that Requirement 4.2 claims is
        // rendered for every failing outcome.
        expect(read(), `${name} must read the same twice`).toBe(read());
        expect(read(), `${name} must read as declared`).toBe(value);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-player-stats-screen, supports Properties 18 and 39: the generic
// failure, the not-found treatment, and the three rating labels assert nothing
// beyond their outcome
// Validates: Requirements 3.5, 3.7, 4.2
describe('messages — the non-disclosing strings carry no number and no identity', () => {
  it('carries no digit character, in any script', () => {
    fc.assert(
      fc.property(nonDisclosureMessageArb, ([name, text]) => {
        // A digit in the Generic_Profile_Failure would be a status code, and a
        // status code is what would make a server that failed distinguishable
        // from a network that dropped and from a body that would not parse
        // (4.2). A digit in the Not_Found_Treatment would be a count or a code
        // narrowing the five concealed causes to one (3.5). A digit in one of
        // the three rating labels would be the rating the label exists to say
        // does not exist — the Provisional_Rating has no firm number, the
        // Never_Played condition has none at all, and an absent rating is not a
        // zero (7.3, 7.4, 7.5).
        expect(digitsIn(text), `${name} must carry no digit`).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('names neither a squad nor a membership', () => {
    fc.assert(
      fc.property(nonDisclosureMessageArb, ([name, text]) => {
        // Requirement 3.6 in the literal for the not-found heading, and the same
        // rule applied to the statement beside it and to the generic failure:
        // none of them names the squad or the membership the route asked for.
        // The rating labels are held to it too, because a label mentioning the
        // membership it sits beside would vary by subject, and the constancy
        // Property 18 rests on would no longer hold.
        expect(
          identityNounsIn(text),
          `${name} must name no squad and no membership`,
        ).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-player-stats-screen, supports Properties 18 and 26: the strings
// the rendered distinctness claims rest on are themselves distinguishable
// Validates: Requirements 3.5, 4.2
describe('messages — the pinned copy is the copy the requirements name', () => {
  it('keeps the three non-numeric rating labels pairwise distinct, none inside another', () => {
    // Property 18 claims the four Rating_Conditions are mutually
    // distinguishable as rendered. A rendered test can only observe that if the
    // three non-numeric labels read differently — and substring containment
    // matters as much as equality, because an assertion that the rendered text
    // *contains* one label would also pass for the label that contains it. This
    // is the conflation the shipped squads player list carries (7.6).
    const texts = RATING_CONDITION_LABELS.map(([, text]) => text);

    expect(new Set(texts).size).toBe(texts.length);

    for (const [name, text] of RATING_CONDITION_LABELS) {
      for (const [otherName, otherText] of RATING_CONDITION_LABELS) {
        if (name === otherName) {
          continue;
        }

        expect(
          otherText.includes(text),
          `${otherName} must not contain ${name}`,
        ).toBe(false);
      }
    }
  });

  it('keeps the two tracking statements distinct, neither inside the other', () => {
    // Property 26's rendered half: a squad that does not record live match
    // detail is never presented as a squad that records it and has none
    // (11.1, 11.2, 11.6).
    expect(messages.TRACKING_DISABLED).not.toBe(messages.TRACKING_EMPTY);
    expect(messages.TRACKING_DISABLED.includes(messages.TRACKING_EMPTY)).toBe(false);
    expect(messages.TRACKING_EMPTY.includes(messages.TRACKING_DISABLED)).toBe(false);
  });

  it('keeps the not-found statement distinct from the generic failure', () => {
    // Requirement 4.3: the Not_Found_Treatment is rendered for no outcome other
    // than not-found, and the Generic_Profile_Failure for no not-found outcome.
    // Neither test could observe that if the two read alike.
    expect(messages.NOT_FOUND_TREATMENT_STATEMENT).not.toBe(
      messages.GENERIC_PROFILE_FAILURE,
    );
    expect(
      messages.NOT_FOUND_TREATMENT_STATEMENT.includes(messages.GENERIC_PROFILE_FAILURE),
    ).toBe(false);
  });

  it('states in text that the player was not found or is not accessible', () => {
    // Requirement 3.5 fixes what this sentence must say, and the generated
    // properties read it from the module, so they could not catch a rewording
    // that dropped the "or not accessible" half — the half that keeps a person
    // who is not a member indistinguishable from one who mistyped an
    // identifier.
    const statement = messages.NOT_FOUND_TREATMENT_STATEMENT.toLowerCase();

    expect(statement).toContain('not found');
    expect(statement).toContain('not available to you');
  });

  it('exports at least the strings the screen is known to need', () => {
    // A floor on the dynamically read set: if the namespace import were to yield
    // nothing — a renamed module, a barrel mistake — every property above would
    // pass over an empty generator. `fc.constantFrom` would in fact throw on an
    // empty set, but the count is asserted so the reason is stated rather than
    // inferred from a generator error.
    expect(messageEntries.length).toBeGreaterThanOrEqual(30);
    expect(messageEntries.every(([, value]) => typeof value === 'string')).toBe(true);
  });
});

// Feature: web-player-stats-screen, supports Properties 18, 26, and 39: the
// detectors above are not vacuous
// Validates: Requirements 3.5, 3.7, 4.2, 14.5
describe('messages — the detectors catch what they claim to catch', () => {
  it('finds an interpolation character injected anywhere in a string', () => {
    fc.assert(
      fc.property(injectionArb(interpolationCharacterArb), ({ text, injected }) => {
        // Without this, a detector that looked for the wrong characters would
        // let every message above pass while `${playerName}` sat in one of them.
        expect(interpolationCharactersIn(text)).toContain(injected);
      }),
      { numRuns: 300 },
    );
  });

  it('finds a digit injected anywhere in a string, ASCII or not', () => {
    fc.assert(
      fc.property(injectionArb(digitCharacterArb), ({ text, injected }) => {
        expect(digitsIn(text)).toContain(injected);
      }),
      { numRuns: 300 },
    );
  });

  it('finds a squad or membership noun injected in a string, whatever its case', () => {
    fc.assert(
      fc.property(
        fc.tuple(surroundingTextArb, identityNounArb, fc.nat()),
        ([surrounding, noun, position]) => {
          const text = inject(surrounding, ` ${noun} `, position);

          expect(identityNounsIn(text).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('finds an identity value injected in a string, in either form', () => {
    fc.assert(
      fc.property(
        fc.tuple(surroundingTextArb, identityValueArb, fc.nat()),
        ([surrounding, identity, position]) => {
          const text = inject(surrounding, ` ${identity} `, position);

          expect(identityShapesIn(text).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('finds each placeholder form it names', () => {
    fc.assert(
      fc.property(
        surroundingTextArb,
        fc.constantFrom('%s', '%d', '%1$s', ':membershipId', '<name>', '[[value]]'),
        fc.nat(),
        (surrounding, placeholder, position) => {
          const text = inject(surrounding, placeholder, position);

          const detected =
            placeholderFormsIn(text).length > 0 ||
            interpolationCharactersIn(text).length > 0;

          expect(detected).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('does not read a common noun as an identity, so the scope is the stated one', () => {
    // The scoping decision stated above, asserted rather than left in a comment.
    // Requirement 3.5 obliges the Not_Found_Treatment to say a *player* was not
    // found, so a detector banning that noun outright would reject the copy the
    // requirement asks for. `remember` is the near-miss on the other side: a
    // substring match would read it as `member`.
    expect(identityNounsIn('This player was not found.')).toEqual([]);
    expect(identityNounsIn('Remember to bring your boots.')).toEqual([]);
    expect(identityNounsIn('Dismembered, remembering, membranes.')).toEqual([]);

    // And it still fires on the thing it is for.
    expect(identityNounsIn('Squad 7 is not your squad.').length).toBeGreaterThan(0);
    expect(identityNounsIn('That membership is inactive.').length).toBeGreaterThan(0);
  });
});
