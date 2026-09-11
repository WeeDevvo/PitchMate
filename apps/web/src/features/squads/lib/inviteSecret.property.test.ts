import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { redeemableValueFrom } from './inviteSecret';
import { inviteLandingPath } from './routePaths';
import * as messages from './messages';

/**
 * Property tests for the Invite_Secret derivation, placed beside the module they
 * cover as the design's Testing Strategy asks, and running well above the
 * 100-iteration floor (20.1).
 *
 * These carry **Property 8: The Invite_Secret is derived from either input form
 * and never disclosed**, which is two claims joined by one value:
 *
 *  - **Derivation (4.4).** An invite reaches a person in two shapes — the short
 *    Invite_Code, and the absolute Invite_Link `GenerateInvite` returns — and the
 *    backend matches exactly one value. So for every Invite_Secret, the value
 *    submitted to `RedeemInvite` is that secret when the Join_Code_Form field
 *    carries the code *and* when it carries the link built from it. The link here
 *    is built the way the backend builds it (`https://pitch-mate.co.uk/join/…`,
 *    per `InviteSecretService`) and its path comes from `inviteLandingPath` in
 *    `./routePaths`, so the round trip pins the two `lib/` modules together
 *    rather than restating one of them: a change to how the path is encoded fails
 *    here.
 *  - **Non-disclosure (4.10).** The secret must reach no outcome message. That is
 *    a *structural* claim, not an editorial one, and the mechanism is the absence
 *    of a seam: every export of `./messages` is a plain constant string, so there
 *    is no parameter through which a secret could arrive and no placeholder
 *    awaiting a formatter. What is checked here is that the seam does not exist
 *    and that no message varies with a secret, whatever the secret is. (The rest
 *    of Property 8 — that no *rendered* surface and no logged value carries the
 *    secret — is a rendering claim, carried by the Join_Squad and Invite_Landing
 *    surface tests. `messages.property.test.ts` makes the same structural check
 *    from the copy's side; the overlap is deliberate, because from this side it is
 *    what makes the derivation safe to perform at all.)
 *
 * **The generated domain, and why it is restricted.** Generators reach the edges
 * the task names: lengths of exactly 1, 8, 12, and 512 characters, the reserved
 * characters `/ ? # & = % +`, and non-ASCII text including astral-plane
 * characters. Two restrictions apply, and both are properties of the derivation's
 * stated domain rather than convenience:
 *
 *  1. **A secret that is itself an invite link is excluded.** `redeemableValueFrom`
 *     answers a pasted link by yielding its token — so a "secret" that *is* a URL
 *     containing `/join/` is genuinely ambiguous, and the two input forms cannot
 *     agree on it. A backend token is never a URL. The exclusion is enforced by
 *     {@link isInviteLinkShaped} and its consequence is pinned by an explicit case
 *     below rather than left unsaid.
 *  2. **Edge whitespace is outside the character-for-character claim.** Both
 *     derivations trim, so a secret intending to carry leading or trailing
 *     whitespace comes back trimmed. `inviteSecret.ts` documents this, the
 *     backend's tokens carry no such whitespace, and the weaker claim that *does*
 *     hold over padded input — both forms yield the trimmed value — is stated as
 *     its own property rather than skipped.
 *
 * Generators produce well-formed strings only. A lone surrogate is not a
 * well-formed string, `encodeURIComponent` rejects it, and neither a typed field
 * value nor a decoded path segment can carry one, so it is outside the function's
 * domain rather than an untested case.
 */

// --- building the link form ----------------------------------------------------

/**
 * The origin `GenerateInvite`'s `redeemableLink` carries (design → contract
 * realities). Written here as the literal the backend uses, so the link form
 * these properties exercise is the shape a person actually pastes.
 */
const INVITE_ORIGIN = 'https://pitch-mate.co.uk';

/**
 * The absolute Invite_Link for a secret, built from `inviteLandingPath` rather
 * than from a second copy of the encoding.
 *
 * That is the point of building it this way: `redeemableValueFrom` reads the
 * final segment back, so the two modules are pinned to one encoding by the round
 * trip instead of by a comment.
 */
function inviteLinkFor(secret: string): string {
  return `${INVITE_ORIGIN}${inviteLandingPath(secret)}`;
}

/** Whether a candidate parses as an absolute URL — written from the URL Standard. */
function parsesAsUrl(candidate: string): boolean {
  try {
    new URL(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a candidate is itself shaped like an Invite_Link — an absolute URL whose
 * text carries the `/join/` marker.
 *
 * The one shape excluded from the generated domain: `redeemableValueFrom` treats
 * such a value as a link and yields its token, so it cannot also be a secret
 * yielded unchanged. The ambiguity is inherent to accepting both forms in one
 * field (4.4) and is pinned as a stated case below.
 */
function isInviteLinkShaped(candidate: string): boolean {
  return parsesAsUrl(candidate) && candidate.includes('/join/');
}

// --- generators ----------------------------------------------------------------

/** The characters reserved in a URL, each of which the link form must encode away. */
const RESERVED_CHARACTERS = ['/', '?', '#', '&', '=', '%', '+'] as const;

/** The exact secret lengths the design's Testing Strategy names. */
const SECRET_LENGTHS = [1, 8, 12, 512] as const;

/** Characters a backend token plausibly uses. */
const tokenCharacterArb = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split(''),
);

/** Every reserved character, so a secret carrying one is generated often. */
const reservedCharacterArb = fc.constantFrom(...RESERVED_CHARACTERS);

/**
 * Non-ASCII characters of a single UTF-16 code unit, across several scripts.
 *
 * Single-code-unit on purpose: they are the units of the fixed-length family, so
 * a request for a 512-character secret yields a string of exactly 512 characters.
 * None is whitespace, so a generated secret is trim-stable by construction.
 */
const nonAsciiCharacterArb = fc.constantFrom(
  'ü',
  'é',
  'ñ',
  'ß',
  'Ω',
  '√',
  '≈',
  'ç',
  '日',
  '語',
  'Ж',
  'ﬀ',
  '—',
  '·',
  '¿',
);

/** Any single-code-unit secret character: token, reserved, or non-ASCII. */
const secretCharacterArb = fc.oneof(
  { weight: 4, arbitrary: tokenCharacterArb },
  { weight: 3, arbitrary: reservedCharacterArb },
  { weight: 3, arbitrary: nonAsciiCharacterArb },
);

/**
 * A secret of exactly 1, 8, 12, or 512 characters — the lengths named for this
 * property, with 8 and 12 the bounds of the short Invite_Code.
 */
const fixedLengthSecretArb: fc.Arbitrary<string> = fc
  .constantFrom(...SECRET_LENGTHS)
  .chain((length) =>
    fc.string({ unit: secretCharacterArb, minLength: length, maxLength: length }),
  );

/** Curated secrets a reader can recognise, including the shapes URL parsing normalises. */
const curatedSecretArb: fc.Arbitrary<string> = fc.constantFrom(
  'a',
  '/',
  '?',
  '#',
  '&',
  '=',
  '%',
  '+',
  '%2F',
  '%zz',
  '%%%',
  'a/b',
  'a?b=c',
  'a#b',
  'a&b=c+d',
  '.',
  '..',
  '../../etc/passwd',
  './.',
  'join',
  'ABCD1234',
  'ABCD1234EFGH',
  'ünïcödé',
  '日本語',
  'Ω≈ç√',
  '🙈🙉🙊',
  'a'.repeat(512),
  '%'.repeat(512),
  '/'.repeat(512),
  '日'.repeat(512),
);

/** Any Invite_Secret shape: fixed-length, curated, free text, or graphemes. */
const anySecretArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fixedLengthSecretArb },
  { weight: 4, arbitrary: curatedSecretArb },
  { weight: 2, arbitrary: fc.string({ minLength: 1, maxLength: 64 }) },
  {
    weight: 2,
    arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 64 }),
  },
);

/**
 * A secret within the character-for-character domain: non-empty, free of edge
 * whitespace, and not itself an Invite_Link.
 *
 * Both exclusions are explained in the module docblock above and both are pinned
 * by stated cases at the foot of this file, so neither is a silent narrowing.
 */
const secretArb: fc.Arbitrary<string> = anySecretArb.filter(
  (secret) =>
    secret.length > 0 && secret === secret.trim() && !isInviteLinkShaped(secret),
);

/** Whitespace a person's paste or a mail client's wrapping might add. */
const whitespaceArb = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0', '\u3000'),
  minLength: 0,
  maxLength: 4,
});

/** A secret with whitespace added at either end — what a paste actually looks like. */
const paddedSecretArb: fc.Arbitrary<{
  readonly padded: string;
  readonly secret: string;
}> = fc
  .tuple(whitespaceArb, secretArb, whitespaceArb)
  .map(([before, secret, after]) => ({ padded: `${before}${secret}${after}`, secret }));

// Feature: web-squads-screens, Property 8: The Invite_Secret is derived from
// either input form and never disclosed
// Validates: Requirements 4.4, 4.10
describe('inviteSecret — the redeemable value is the secret from either input form', () => {
  it('yields the secret unchanged when the field carries the short Invite_Code', () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        // 4.4: any non-empty trimmed input that is not a link *is* the redeemable
        // value already — the short code needs no derivation, so nothing may be
        // repaired, re-encoded, or case-folded on the way to `RedeemInvite`.
        expect(redeemableValueFrom(secret)).toBe(secret);
      }),
      { numRuns: 500 },
    );
  });

  it('yields the secret when the field carries the Invite_Link built from it', () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        // 4.4: the token in the link's final segment is the value the backend
        // hashes. Character-for-character, so a reserved character encoded into
        // the path and a non-ASCII character percent-escaped both come back as
        // themselves.
        expect(redeemableValueFrom(inviteLinkFor(secret))).toBe(secret);
      }),
      { numRuns: 500 },
    );
  });

  it('derives the same value from both forms, and deriving again changes nothing', () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        const fromCode = redeemableValueFrom(secret);
        const fromLink = redeemableValueFrom(inviteLinkFor(secret));

        // The claim the Join_Code_Form rests on: one field, two shapes, one
        // submitted value. A person who pastes the whole link and a person who
        // types the code send the backend the same thing.
        expect(fromLink).toBe(fromCode);

        // Idempotent, so a value that has already been derived can be handed
        // through the function again without being eroded.
        expect(redeemableValueFrom(fromLink)).toBe(secret);
      }),
      { numRuns: 500 },
    );
  });

  it('ignores a query string and a fragment appended to the link', () => {
    fc.assert(
      fc.property(
        secretArb,
        fc.constantFrom('', '?utm_source=whatsapp', '?a=1&b=2'),
        fc.constantFrom('', '#', '#top', '#a?b'),
        (secret, query, fragment) => {
          // A link forwarded through a messaging app arrives with tracking
          // parameters attached. Neither introducer can be part of the secret —
          // both are percent-encoded into the path — so cutting at the first of
          // them cannot lose any of it (20.8).
          expect(
            redeemableValueFrom(`${inviteLinkFor(secret)}${query}${fragment}`),
          ).toBe(secret);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('derives the trimmed value from either form when the input is padded', () => {
    fc.assert(
      fc.property(paddedSecretArb, ({ padded, secret }) => {
        // 4.2: the submitted value is trimmed, whichever shape it arrived in. So a
        // pasted code with a stray newline and the same code inside a link agree,
        // and both agree with the unpadded secret — which is what makes the
        // trimming a property of the derivation rather than of one entry point.
        expect(redeemableValueFrom(padded)).toBe(secret);
        expect(redeemableValueFrom(inviteLinkFor(padded))).toBe(secret);
      }),
      { numRuns: 500 },
    );
  });

  it('is pure and total: never throws, and the same input always derives the same value', () => {
    fc.assert(
      fc.property(anySecretArb, (input) => {
        const link = inviteLinkFor(input);

        expect(redeemableValueFrom(input)).toBe(redeemableValueFrom(input));
        expect(redeemableValueFrom(link)).toBe(redeemableValueFrom(link));

        // Totality matters because the input is whatever was typed or pasted: a
        // lone `%`, a truncated link, a wall of reserved characters. Every one of
        // them must yield a string rather than break the form.
        expect(typeof redeemableValueFrom(input)).toBe('string');
        expect(typeof redeemableValueFrom(link)).toBe('string');
      }),
      { numRuns: 500 },
    );
  });
});

// --- non-disclosure: the seam a secret would need does not exist ---------------

/** Every export of the messages module, read dynamically so later copy is covered. */
const messageEntries: readonly (readonly [string, unknown])[] = Object.entries(messages);

/** The message texts, snapshotted before any derivation runs. */
const messageTextsAtLoad: readonly string[] = messageEntries.map(([, value]) =>
  String(value),
);

/**
 * The characters an interpolation would have to pass through: `${…}` for a
 * template literal, `{0}` and `{name}` for a formatter.
 */
const INTERPOLATION_CHARACTERS = ['{', '}', '$'] as const;

/** The placeholder forms other than the brace and dollar ones. */
const PLACEHOLDER_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['printf-style', /%[-+ 0#]*\d*(?:\.\d+)?[sdifgeoxXucpn@]/],
  ['positional', /%\d/],
  ['router-style', /:[A-Za-z_]\w*/],
  ['angle-bracketed', /<[^<>]+>/],
];

/** Whether a value offers a seam through which a secret could reach the copy. */
function interpolationSeamsIn(value: unknown): readonly string[] {
  if (typeof value === 'function') {
    // A message that takes an argument is the seam itself, whatever its body.
    return ['accepts a parameter'];
  }

  if (typeof value !== 'string') {
    return ['is not a plain string'];
  }

  return [
    ...[...value].filter((character) =>
      (INTERPOLATION_CHARACTERS as readonly string[]).includes(character),
    ),
    ...PLACEHOLDER_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(
      ([name]) => name,
    ),
  ];
}

const messageEntryArb: fc.Arbitrary<readonly [string, unknown]> = fc.constantFrom(
  ...messageEntries,
);

// Feature: web-squads-screens, Property 8: The Invite_Secret is derived from
// either input form and never disclosed
// Validates: Requirements 4.4, 4.10
describe('inviteSecret — the secret is a value, and no message can carry it', () => {
  it('exports every message as a plain string that accepts no interpolation parameter', () => {
    fc.assert(
      fc.property(messageEntryArb, ([name, value]) => {
        // 4.10 is kept by a mechanism rather than by care: there is no message
        // that takes the secret, so no outcome can echo it back. A message that
        // became a template function, or that gained a `{0}` awaiting a
        // formatter, would be that seam reappearing — so it fails here, at the
        // module that holds the secret, and not only in the copy's own tests.
        expect(interpolationSeamsIn(value), `${name} must offer no interpolation seam`).toEqual(
          [],
        );
      }),
      { numRuns: 300 },
    );
  });

  it('leaves every message byte-identical whatever secret is derived', () => {
    fc.assert(
      fc.property(anySecretArb, (secret) => {
        redeemableValueFrom(secret);
        redeemableValueFrom(inviteLinkFor(secret));

        // The derivation is pure, so it can have written nothing into the copy —
        // and because the copy is constant, no rendered message can differ
        // between a person who redeemed one secret and a person who redeemed
        // another. That indistinguishability is what 4.10 asks for.
        expect(messageEntries.map(([, value]) => String(value))).toEqual(
          messageTextsAtLoad,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('derives a value that is the secret and never a message', () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        const derived = redeemableValueFrom(secret);
        const derivedFromLink = redeemableValueFrom(inviteLinkFor(secret));

        // The derivation's whole output is the secret: nothing is prefixed,
        // appended, or substituted, so the value that reaches the request body
        // carries no copy along with it and no copy can have absorbed it.
        expect(derived).toBe(secret);
        expect(derivedFromLink).toBe(secret);
        expect(messageTextsAtLoad).not.toContain(derived);
        expect(messageTextsAtLoad).not.toContain(derivedFromLink);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 8 (oracle check): the seam detector is
// not vacuous
// Validates: Requirements 4.10
describe('inviteSecret — the seam detector catches what it claims to catch', () => {
  it('flags a message that accepts a parameter', () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        // Without this, a detector that only looked at strings would pass over
        // exactly the defect the property exists to exclude.
        const parameterised = (value: string) => `This invite cannot be used: ${value}`;

        expect(interpolationSeamsIn(parameterised)).not.toEqual([]);
        expect(parameterised(secret)).toContain(secret);
      }),
      { numRuns: 200 },
    );
  });

  it('flags a message carrying an unfilled placeholder, in any form', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'This invite cannot be used: ${secret}',
          'This invite cannot be used: {0}',
          'This invite cannot be used: {secret}',
          'This invite cannot be used: %s',
          'This invite cannot be used: %1',
          'This invite cannot be used: :code',
          'This invite cannot be used: <code>',
        ),
        (text) => {
          expect(interpolationSeamsIn(text)).not.toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reads a non-empty set of messages, so the properties above are not empty', () => {
    // `fc.constantFrom` would throw on an empty set, but the count is asserted so
    // a barrel or naming mistake states its reason rather than surfacing as a
    // generator error.
    expect(messageEntries.length).toBeGreaterThanOrEqual(18);
    expect(messageTextsAtLoad.every((text) => text.length > 0)).toBe(true);
  });
});

describe('inviteSecret — the derivations a reader can check by eye', () => {
  it('derives the token from the link the backend actually returns', () => {
    // `GenerateInvite` builds `https://pitch-mate.co.uk/join/{token}`, so this is
    // the exact string a person pastes out of a message.
    expect(redeemableValueFrom('https://pitch-mate.co.uk/join/ABCD1234')).toBe(
      'ABCD1234',
    );
    expect(inviteLinkFor('ABCD1234')).toBe('https://pitch-mate.co.uk/join/ABCD1234');

    // Reserved characters survive the round trip through the encoded segment.
    expect(inviteLinkFor('a/b?c#d')).toBe(
      'https://pitch-mate.co.uk/join/a%2Fb%3Fc%23d',
    );
    expect(
      redeemableValueFrom('https://pitch-mate.co.uk/join/a%2Fb%3Fc%23d'),
    ).toBe('a/b?c#d');
  });

  it('passes a short code through untouched, whatever it looks like', () => {
    expect(redeemableValueFrom('ABCD1234')).toBe('ABCD1234');
    expect(redeemableValueFrom('  abcd-1234  ')).toBe('abcd-1234');
    expect(redeemableValueFrom('%')).toBe('%');
    expect(redeemableValueFrom('..')).toBe('..');

    // Scheme-less, so not a URL: passed through as typed and answered by the
    // backend rather than repaired here on a hunch about what was meant (4.4).
    expect(redeemableValueFrom('pitch-mate.co.uk/join/ABCD1234')).toBe(
      'pitch-mate.co.uk/join/ABCD1234',
    );
  });

  it('hands back the input unchanged when a link carries no usable final segment', () => {
    // The documented fallback in `inviteSecret.ts`: a link truncated at the
    // slash, one whose segment is whitespace, and one whose segment holds a
    // malformed escape all carry no secret, so the trimmed input is returned
    // rather than an empty value the backend could not match. This is the second
    // clause of 4.4 — "any other non-empty trimmed input yields that input
    // unchanged" — applied to a URL that is not an invite link carrying a token,
    // so it is behaviour the requirement covers rather than a gap in it.
    expect(redeemableValueFrom('https://pitch-mate.co.uk/join/')).toBe(
      'https://pitch-mate.co.uk/join/',
    );
    expect(redeemableValueFrom('https://pitch-mate.co.uk/join/%20%20')).toBe(
      'https://pitch-mate.co.uk/join/%20%20',
    );
    expect(redeemableValueFrom('https://pitch-mate.co.uk/join/%zz')).toBe(
      'https://pitch-mate.co.uk/join/%zz',
    );

    // A URL that is not an invite link at all is likewise the input itself.
    expect(redeemableValueFrom('https://pitch-mate.co.uk/app/squads/abc')).toBe(
      'https://pitch-mate.co.uk/app/squads/abc',
    );

    // An empty or whitespace-only field yields the empty string, which keeps the
    // function total; the form issues no call while the field is empty (4.3).
    expect(redeemableValueFrom('')).toBe('');
    expect(redeemableValueFrom('   \t\n ')).toBe('');
  });

  it('states the one ambiguity excluded from the generated domain', () => {
    // A "secret" that is itself an invite link cannot round-trip through both
    // forms, because the first thing the derivation does with a link is read its
    // token. `secretArb` therefore excludes it, and the exclusion is pinned here
    // so it is a stated consequence of accepting both shapes in one field (4.4)
    // rather than an unexamined gap. A backend token is never a URL, so nothing
    // reachable in the product falls into this case.
    const secretThatIsALink = 'https://pitch-mate.co.uk/join/INNER';

    expect(isInviteLinkShaped(secretThatIsALink)).toBe(true);
    expect(redeemableValueFrom(secretThatIsALink)).toBe('INNER');
    expect(redeemableValueFrom(inviteLinkFor(secretThatIsALink))).toBe(
      secretThatIsALink,
    );
  });
});
