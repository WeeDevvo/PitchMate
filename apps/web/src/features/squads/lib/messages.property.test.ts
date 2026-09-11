import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import * as messages from './messages';

/**
 * Property tests for the Squads_Feature's fixed user-facing copy, placed beside
 * the module they cover as the design's Testing Strategy asks, and running well
 * above the 100-iteration floor (20.1).
 *
 * `messages.ts` declares constants, so what is testable here is not behaviour but
 * the *shape* of the copy — and that shape is load-bearing. Two of the feature's
 * numbered properties rest on it:
 *
 *  - **Property 21** claims the Provisional_Band and Rating_Unavailable
 *    presentations are constant and non-numeric (8.4, 8.13). Constancy across
 *    rows is a rendering claim its own test carries; *containing no digit* is a
 *    claim about the string itself, and is settled here.
 *  - **Property 40** claims every failed call presents one generic message naming
 *    no squad, no membership, and no invite (17.1). Whether the screens reach for
 *    that one message is a rendering claim; whether the message *could* name a
 *    squad is a claim about the string, and is settled here.
 *
 * Neither numbered property is claimed by this file. What this file adds is the
 * part of each that a rendered test cannot reach, plus the "every module under
 * `lib/` has an adjacent property test" scan for `messages.ts` (20.1).
 *
 * The exported set is read **dynamically** through a namespace import rather than
 * named one by one. That is the point of the file: a string added to the module
 * next month is covered without anyone remembering to list it here, so the
 * non-disclosure rules apply to copy that does not exist yet.
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
 * The type check is part of the invariant rather than a convenience: the module's
 * mechanism for keeping an Invite_Secret out of a message is that no message is a
 * function taking a parameter (17.2). An export that turned into a template
 * function would fail here rather than quietly gain a seam.
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
 * The digit characters a text carries.
 *
 * Both the ASCII range and every Unicode decimal digit are looked for: a status
 * code or a count reaching a label is the thing being ruled out, and it would be
 * no less a disclosure spelled in Arabic-Indic digits (8.4, 8.13).
 */
function digitsIn(text: string): readonly string[] {
  return [...text].filter(
    (character) => /[0-9]/.test(character) || /\p{Nd}/u.test(character),
  );
}

/**
 * The nouns the three non-disclosure messages must not carry.
 *
 * Deliberately including the singular and the plural, and the near-synonyms a
 * writer might reach for, because the rule is about what the copy asserts rather
 * than about a particular wording. Matched as substrings, which is stricter than
 * whole words: it means `squads` and `squad's` are both caught.
 */
const RESTRICTED_NOUNS = [
  'squad',
  'squads',
  'member',
  'members',
  'membership',
  'memberships',
  'player',
  'players',
  'invite',
  'invites',
  'invitation',
  'invitations',
  'invite link',
  'invite code',
  'link',
  'code',
] as const;

/** The restricted nouns a text carries, compared without regard to letter case. */
function restrictedNounsIn(text: string): readonly string[] {
  const lowered = text.toLowerCase();

  return RESTRICTED_NOUNS.filter((noun) => lowered.includes(noun));
}

/**
 * Placeholder forms other than the brace and dollar ones: `printf`-style `%s`
 * and `%1$d`, and router-style `:name`.
 *
 * Applied only to the three non-disclosure messages, where the rule is that no
 * value of any kind can be folded in (17.1, 17.2).
 */
const PLACEHOLDER_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['printf-style', /%[-+ 0#]*\d*(?:\.\d+)?[sdifgeoxXucpn@]/],
  ['positional', /%\d/],
  ['router-style', /:[A-Za-z_]\w*/],
  ['angle-bracketed', /<[^<>]+>/],
  ['double-brace', /\[\[|\]\]/],
];

/** The names of the placeholder forms a text carries. */
function placeholderFormsIn(text: string): readonly string[] {
  return PLACEHOLDER_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name,
  );
}

/**
 * The three messages the non-disclosure rules bind, read from the module by name
 * because each is named by a requirement.
 */
const NON_DISCLOSURE_MESSAGES: readonly (readonly [string, string])[] = [
  ['PROVISIONAL_BAND_LABEL', messages.PROVISIONAL_BAND_LABEL],
  ['RATING_UNAVAILABLE_LABEL', messages.RATING_UNAVAILABLE_LABEL],
  ['GENERIC_SQUADS_FAILURE', messages.GENERIC_SQUADS_FAILURE],
];

const nonDisclosureMessageArb: fc.Arbitrary<readonly [string, string]> =
  fc.constantFrom(...NON_DISCLOSURE_MESSAGES);

// --- generators: strings that do carry what a detector looks for --------------

/** Text either side of an injected character, including the empty string. */
const surroundingTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 24 }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      'Ratings unavailable',
      'No settled rating yet',
      'Something went wrong just now. Please try again.',
    ),
  },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', minLength: 0, maxLength: 16 }) },
);

/**
 * Injects `injected` into `text` at `position`, clamped into range — the shape of
 * a string that carries the injected character somewhere unpredictable.
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

/** Each restricted noun, in each letter case a writer might use. */
const restrictedNounArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...RESTRICTED_NOUNS),
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

// Feature: web-squads-screens, supports Properties 21 and 40: every fixed
// message is a non-empty plain string carrying no interpolation seam
// Validates: Requirements 17.1, 20.1
describe('messages — every export is a non-empty string with no interpolation seam', () => {
  it('exports a non-empty string, free of leading and trailing whitespace', () => {
    fc.assert(
      fc.property(messageEntryArb, (entry) => {
        const [name] = entry;
        const text = messageText(entry);

        // Empty copy is a blank space where an outcome should be: a person would
        // read a failed call as a successful one. Stray edge whitespace is the
        // same defect in miniature, since these strings are rendered as-is.
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

        // The absence of the parameter is the mechanism by which an Invite_Secret,
        // a squad name, a status code, or a response body value cannot reach a
        // message (17.1, 17.2). A `${…}` left in a template, or a `{0}` awaiting a
        // formatter, would be that seam reappearing — so the characters it would
        // need are absent rather than merely unused.
        expect(
          interpolationCharactersIn(text),
          `${name} must carry no interpolation token`,
        ).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic: reading an export twice yields the same string', () => {
    fc.assert(
      fc.property(messageEntryArb, (entry) => {
        const [name] = entry;

        // Constants, not getters: a message that varied between reads could not be
        // the single message Property 40 claims is rendered for every failure.
        expect(messages[name as keyof typeof messages]).toBe(
          messages[name as keyof typeof messages],
        );
        expect(messages[name as keyof typeof messages]).toBe(entry[1]);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, supports Properties 21 and 40: the band, the
// unavailable label, and the generic failure disclose nothing
// Validates: Requirements 8.4, 8.13, 17.1
describe('messages — the three non-disclosure messages assert nothing beyond their outcome', () => {
  it('carries no digit character, in any script', () => {
    fc.assert(
      fc.property(nonDisclosureMessageArb, ([name, text]) => {
        // A digit in the Provisional_Band would be a rating, a count of matches
        // played, or a range indicator — each of which asserts more than the
        // absence the label is evidence of (8.4). A digit in the
        // Rating_Unavailable label would be an individual player's rating on a row
        // where none was obtained (8.13). A digit in the generic failure would be
        // a status code, and a status code is what makes a squad the caller cannot
        // see distinguishable from a network that dropped (17.1).
        expect(digitsIn(text), `${name} must carry no digit`).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('names no squad, no membership, and no invite', () => {
    fc.assert(
      fc.property(nonDisclosureMessageArb, ([name, text]) => {
        // Requirement 17.1 in the literal: the one generic message names none of
        // the three. The same rule is applied to the two rating labels, because a
        // label mentioning the membership it sits beside would vary by row and
        // Property 21's constancy claim would no longer hold.
        expect(
          restrictedNounsIn(text),
          `${name} must name no squad, membership, or invite`,
        ).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('carries no placeholder of any form a formatter could fill', () => {
    fc.assert(
      fc.property(nonDisclosureMessageArb, ([name, text]) => {
        // Beyond the brace and dollar forms every message is checked for: a
        // `printf` conversion, a positional `%1`, a router-style `:squadId`, or an
        // angle-bracketed slot would each be a seam through which a value the
        // requirement excludes could still arrive (17.1, 17.2).
        expect(
          placeholderFormsIn(text),
          `${name} must carry no placeholder`,
        ).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, supports Properties 21 and 40: the detectors
// above are not vacuous
// Validates: Requirements 8.4, 17.1, 20.1
describe('messages — the detectors catch what they claim to catch', () => {
  it('finds an interpolation character injected anywhere in a string', () => {
    fc.assert(
      fc.property(injectionArb(interpolationCharacterArb), ({ text, injected }) => {
        // Without this, a detector that looked for the wrong characters would let
        // every message above pass while `${squadName}` sat in one of them.
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

  it('finds a restricted noun injected in a string, whatever its letter case', () => {
    fc.assert(
      fc.property(
        fc.tuple(surroundingTextArb, restrictedNounArb, fc.nat()),
        ([surrounding, noun, position]) => {
          const text = inject(surrounding, ` ${noun} `, position);

          expect(restrictedNounsIn(text).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('finds each placeholder form it names', () => {
    fc.assert(
      fc.property(
        surroundingTextArb,
        fc.constantFrom('%s', '%d', '%1$s', ':squadId', '<name>', '[[value]]'),
        fc.nat(),
        (surrounding, placeholder, position) => {
          const text = inject(surrounding, placeholder, position);

          expect(placeholderFormsIn(text).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('messages — the pinned copy is the copy the requirements name', () => {
  it('states the two rating labels literally', () => {
    // The generated properties read these from the module, so they could not
    // catch a reworded label on their own. The wording is pinned because
    // Requirement 8.4 fixes what the band may state and 8.13 fixes that the
    // unavailable label speaks of ratings in general.
    expect(messages.PROVISIONAL_BAND_LABEL).toBe('No settled rating yet');
    expect(messages.RATING_UNAVAILABLE_LABEL).toBe('Ratings unavailable');
  });

  it('keeps the three rating and failure presentations distinguishable', () => {
    const texts = NON_DISCLOSURE_MESSAGES.map(([, text]) => text);

    // Property 21 claims exactly one Rating_Presentation per Player_Row, and a
    // test can only observe that if the band and the unavailable label read
    // differently. The same holds for telling a degraded rating column from a
    // failed call.
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('exports at least the strings the screens are known to need', () => {
    // A floor on the dynamically read set: if the namespace import were to yield
    // nothing — a barrel mistake, a renamed module — every property above would
    // pass over an empty generator. `fc.constantFrom` would in fact throw on an
    // empty set, but the count is asserted so the reason is stated rather than
    // inferred from a generator error.
    expect(messageEntries.length).toBeGreaterThanOrEqual(18);
    expect(messageEntries.every(([, value]) => typeof value === 'string')).toBe(true);
  });
});
