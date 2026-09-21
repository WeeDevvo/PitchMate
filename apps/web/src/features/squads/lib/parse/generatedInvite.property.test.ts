import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isSquadIdentifier } from '../identifiers';
import { MAX_INSTANT_MS, readInstantMs, type ParseResult } from './primitives';
import { parseGeneratedInvite, type GeneratedInvite } from './generatedInvite';

/**
 * Property test for the `GenerateInvite` body shape, placed beside the module it
 * covers as the design's Testing Strategy asks and running well above the
 * 100-iteration floor (20.1).
 *
 * This file carries **Property 35** for `generatedInvite.ts`: for any value
 * supplied as a response body — absent, `null`, a primitive of every type, an
 * array, an object with each required field missing, an object with each field
 * mistyped, and a value nested a hundred levels deep — the parser yields exactly one
 * of a fully populated Generated_Invite and a parse failure, and raises nothing
 * (16.4).
 *
 * This is the only response in the feature carrying an Invite_Secret, and it
 * carries it once: the backend stores a one-way hash, so nothing can re-read the
 * link or the code afterwards. Three consequences drive the assertions.
 *
 * **Both secret-bearing fields are required and non-empty.** A value carrying a
 * link without its code (or the reverse) would be a surface a person cannot recover
 * from, so the generators feed `''` for each — the case a `minLength: 0` reader
 * would let through — and each must fail the body.
 *
 * **`redeemableLink` is a plain non-empty string, not a validated URL.** A link this
 * parser rejected would destroy a secret already issued, so arbitrary strings,
 * non-URL text, and non-`pitch-mate.co.uk` origins must all parse. That is asserted
 * positively rather than left implicit.
 *
 * **No failure reason names a value** (4.10). The reason assertions below feed
 * realistic secrets through the malformed paths and check that none of them appears
 * in the reason, because a reason is the one string a malformed body could otherwise
 * smuggle a secret into a log through.
 *
 * `expiresAt` is `null` for a non-expiring invite — an absence with meaning — and a
 * *present* malformed instant still fails.
 *
 * Requirements: 4.10, 16.4, 20.10
 */

/* -------------------------------------------------------------------------- */
/* The totality harness                                                       */
/* -------------------------------------------------------------------------- */

/** A value's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * Settles one parse and asserts Property 35's frame: no exception, exactly one of
 * the two result shapes with exactly its own fields, a fully populated value on
 * success, and a non-empty diagnostic reason on failure.
 */
function settle<T>(
  parse: () => ParseResult<T>,
  isFullyPopulated: (value: T) => boolean,
): ParseResult<T> {
  let outcome: ParseResult<T>;

  try {
    outcome = parse();
  } catch (raised) {
    // 16.4: the parser raises nothing, for any input at all.
    throw new Error(`the parser raised instead of failing: ${String(raised)}`, {
      cause: raised,
    });
  }

  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();
  expect(typeof outcome.ok).toBe('boolean');

  if (outcome.ok) {
    expect(keySignature(outcome)).toBe('ok,value');
    expect(isFullyPopulated(outcome.value)).toBe(true);
  } else {
    expect(keySignature(outcome)).toBe('ok,reason');
    expect(typeof outcome.reason).toBe('string');
    expect(outcome.reason.length).toBeGreaterThan(0);
  }

  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Generators over the whole input space                                      */
/* -------------------------------------------------------------------------- */

/** A well-formed identity, for the generators that need one to spoil. */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/** Values of every primitive type, together with the two absences. */
const primitiveArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      0,
      -0,
      1,
      3,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_INSTANT_MS,
      1_700_000_000_000,
      '',
      ' ',
      '0',
      'null',
      '{}',
      WELL_FORMED_IDENTITY,
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00',
      0n,
      Symbol('wire'),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 2, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.integer({ min: -4, max: 8 }) },
  { weight: 1, arbitrary: fc.boolean() },
);

/** Arrays, plain objects, and the exotic object shapes a body could carry. */
const structuralArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom<unknown>(
      [],
      [{}],
      [[]],
      {},
      { inviteId: WELL_FORMED_IDENTITY },
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['code', 'ABCD1234']]),
      new Set<unknown>([1]),
      () => ({}),
      Object(1),
      Object('a'),
    ),
  },
  { weight: 3, arbitrary: fc.array(primitiveArb, { maxLength: 4 }) },
  {
    weight: 3,
    arbitrary: fc.dictionary(fc.string({ maxLength: 8 }), primitiveArb, {
      maxKeys: 5,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.anything({
      maxDepth: 3,
      withBigInt: true,
      withDate: true,
      withMap: true,
      withSet: true,
      withNullPrototype: true,
      withObjectString: true,
    }),
  },
);

/** The whole input space Property 35 quantifies over. */
const anyBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: primitiveArb },
  { weight: 5, arbitrary: structuralArb },
);

/** Wraps `leaf` in `depth` levels of alternating arrays and objects. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { value };
  }

  return value;
}

/** A value nested to between 1 and 100 levels. */
const deeplyNestedArb: fc.Arbitrary<unknown> = fc
  .tuple(primitiveArb, fc.integer({ min: 1, max: 100 }))
  .map(([leaf, depth]) => nest(leaf, depth));

/* -------------------------------------------------------------------------- */
/* Field-level generators                                                     */
/* -------------------------------------------------------------------------- */

/** Well-formed identities, including the two extremes of the form. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      WELL_FORMED_IDENTITY,
      WELL_FORMED_IDENTITY.toUpperCase(),
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ),
  },
);

/**
 * Redeemable links, from the shape the backend builds today to values that are no
 * URL at all. Every one must parse: this parser establishes the *type*, and the
 * token extraction is `lib/inviteSecret.ts`'s single opinion about the shape.
 */
const redeemableLinkArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      'https://pitch-mate.co.uk/join/abc',
      `https://pitch-mate.co.uk/join/${'t'.repeat(512)}`,
      'https://pitch-mate.co.uk/join/a%2Fb',
      'http://localhost:5173/join/abc',
      '/join/abc',
      'not a url at all',
      'x',
      ' ',
      'https://example.test/join/ünïcødé',
    ),
  },
  { weight: 2, arbitrary: fc.string({ minLength: 1, maxLength: 60 }) },
);

/**
 * Invite codes at the lengths the design names — 1, 8, 12, and 512 — with reserved
 * and non-ASCII characters among them.
 */
const inviteCodeArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      'A',
      'ABCD1234',
      'ABCD1234EFGH',
      'c'.repeat(512),
      ' ',
      '?&=/#%',
      'ünïcødé',
    ),
  },
  { weight: 2, arbitrary: fc.string({ minLength: 1, maxLength: 40 }) },
);

/** Instant strings the reader accepts, in each of the forms it accepts. */
const instantTextArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      '1970-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00Z',
      '2026-01-01T01:00:00+01:00',
      '2026-01-01T01:00:00+0100',
      '2026-01-01T01:00:00+01',
      '2024-02-29T23:59:59.999Z',
      '+002026-01-01T00:00:00Z',
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: -62_000_000_000_000, max: 253_000_000_000_000 })
      .map((instantMs) => new Date(instantMs).toISOString()),
  },
);

/** Values no identity field accepts, including the near misses of the form. */
const notAnIdentityArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      '',
      ' ',
      0,
      1,
      true,
      WELL_FORMED_IDENTITY.replace(/-/g, ''),
      `{${WELL_FORMED_IDENTITY}}`,
      ` ${WELL_FORMED_IDENTITY}`,
      `${WELL_FORMED_IDENTITY} `,
      WELL_FORMED_IDENTITY.slice(0, 35),
      `${WELL_FORMED_IDENTITY}b`,
      [WELL_FORMED_IDENTITY],
      { inviteId: WELL_FORMED_IDENTITY },
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => !isSquadIdentifier(value)) },
);

/**
 * Values no non-empty string field accepts. `''` leads, because a reader without a
 * `minLength: 1` bound would accept it and reveal a link or a code that is not
 * there.
 */
const notANonEmptyStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      '',
      undefined,
      null,
      0,
      1,
      true,
      false,
      Number.NaN,
      [],
      ['a'],
      {},
      { code: 'a' },
      Object('a'),
      0n,
      Symbol('a'),
    ),
  },
  {
    weight: 3,
    arbitrary: anyBodyArb.filter(
      (value) => typeof value !== 'string' || value.length === 0,
    ),
  },
);

/**
 * Present values that name no instant. `null` and an absence are excluded: a
 * non-expiring invite is exactly that absence (16.8-style), so they belong in the
 * well-formed generator.
 */
const notAnInstantArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      '',
      ' ',
      0,
      1_700_000_000_000,
      true,
      '2026-01-01',
      '2026-01-01T00:00:00',
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:00:00+24:00',
      '2023-02-29T00:00:00Z',
      ' 2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z ',
      '+275760-09-14T00:00:00Z',
      ['2026-01-01T00:00:00Z'],
      { expiresAt: '2026-01-01T00:00:00Z' },
    ),
  },
  {
    weight: 2,
    arbitrary: anyBodyArb.filter(
      (value) =>
        value !== null && value !== undefined && !readInstantMs(value, 'field').ok,
    ),
  },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/**
 * A well-formed `GenerateInvite` body, generated across the three forms the expiry
 * may take — a present instant, an explicit `null`, and an absent property.
 */
const wellFormedArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    inviteId: identityArb,
    redeemableLink: redeemableLinkArb,
    code: inviteCodeArb,
    expiresAt: fc.oneof(
      { weight: 3, arbitrary: instantTextArb },
      { weight: 1, arbitrary: fc.constant<unknown>(null) },
    ),
    dropExpiry: fc.boolean(),
  })
  .map(({ inviteId, redeemableLink, code, expiresAt, dropExpiry }) => {
    const body: Record<string, unknown> = { inviteId, redeemableLink, code };

    if (!dropExpiry) {
      body.expiresAt = expiresAt;
    }

    return body;
  });

/** Every field this shape declares, by its wire name. */
const FIELDS = ['inviteId', 'redeemableLink', 'code', 'expiresAt'] as const;

/**
 * Whether a parsed Generated_Invite is fully populated: exactly the four declared
 * fields, each of its declared type, with no field left `undefined`.
 */
function isFullyPopulated(invite: GeneratedInvite): boolean {
  return (
    keySignature(invite) === 'code,expiresAtMs,inviteId,redeemableLink' &&
    isSquadIdentifier(invite.inviteId) &&
    typeof invite.redeemableLink === 'string' &&
    invite.redeemableLink.length > 0 &&
    typeof invite.code === 'string' &&
    invite.code.length > 0 &&
    (invite.expiresAtMs === null ||
      (typeof invite.expiresAtMs === 'number' &&
        Number.isInteger(invite.expiresAtMs) &&
        Math.abs(invite.expiresAtMs) <= MAX_INSTANT_MS))
  );
}

/** `body` without `key`. */
function without(
  body: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const copy = { ...body };

  delete copy[key];

  return copy;
}

/** `body` with `key` defined as an accessor that throws when it is read. */
function throwingAt(
  body: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.defineProperty({ ...body }, key, {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error('a throwing accessor');
    },
  });
}

/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 4.10, 16.4, 20.10
describe('parseGeneratedInvite — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseGeneratedInvite(body), isFullyPopulated);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(() => parseGeneratedInvite(body), isFullyPopulated);

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed body whose every field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom(...FIELDS),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseGeneratedInvite({ ...body, [key]: deep }),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed body into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedArb, (body) => {
        const outcome = settle(() => parseGeneratedInvite(body), isFullyPopulated);

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.inviteId).toBe(body.inviteId);
          // The secret-bearing fields are carried through byte for byte: a trimmed
          // or re-encoded link is a link that no longer redeems.
          expect(outcome.value.redeemableLink).toBe(body.redeemableLink);
          expect(outcome.value.code).toBe(body.code);

          if (body.expiresAt === null || body.expiresAt === undefined) {
            expect(outcome.value.expiresAtMs).toBeNull();
          } else {
            const expected = readInstantMs(body.expiresAt, 'expiresAt');

            expect(expected.ok).toBe(true);
            expect(outcome.value.expiresAtMs).toBe(expected.ok ? expected.value : null);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('accepts a redeemable link of any shape, so no issued secret is destroyed', () => {
    fc.assert(
      fc.property(
        identityArb,
        redeemableLinkArb,
        inviteCodeArb,
        (inviteId, redeemableLink, code) => {
          const outcome = settle(
            () => parseGeneratedInvite({ inviteId, redeemableLink, code }),
            isFullyPopulated,
          );

          // No URL grammar is re-derived here; a second opinion about the link's
          // shape could reject a value the backend had already issued.
          expect(outcome.ok).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails when a required field is absent', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom('inviteId', 'redeemableLink', 'code'),
        (body, key) => {
          const outcome = settle(
            () => parseGeneratedInvite(without(body, key)),
            isFullyPopulated,
          );

          // All or nothing: never a reveal offering a link without its code.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when either secret-bearing field is empty or mistyped', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom('redeemableLink', 'code'),
        notANonEmptyStringArb,
        (body, key, value) => {
          const outcome = settle(
            () => parseGeneratedInvite({ ...body, [key]: value }),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails when the identity is mistyped', () => {
    fc.assert(
      fc.property(wellFormedArb, notAnIdentityArb, (body, inviteId) => {
        const outcome = settle(
          () => parseGeneratedInvite({ ...body, inviteId }),
          isFullyPopulated,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('parses an absent or null expiry as a non-expiring invite', () => {
    fc.assert(
      fc.property(
        identityArb,
        redeemableLinkArb,
        inviteCodeArb,
        fc.constantFrom('present-null', 'present-undefined', 'absent'),
        (inviteId, redeemableLink, code, expiryForm) => {
          const body: Record<string, unknown> = { inviteId, redeemableLink, code };

          if (expiryForm === 'present-null') {
            body.expiresAt = null;
          } else if (expiryForm === 'present-undefined') {
            body.expiresAt = undefined;
          }

          const outcome = settle(
            () => parseGeneratedInvite(body),
            isFullyPopulated,
          );

          // An absence with meaning, not a missing value.
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.expiresAtMs).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when a present expiry names no instant', () => {
    fc.assert(
      fc.property(wellFormedArb, notAnInstantArb, (body, expiresAt) => {
        const outcome = settle(
          () => parseGeneratedInvite({ ...body, expiresAt }),
          isFullyPopulated,
        );

        // Optional means absent-or-valid: a present malformed expiry fails rather
        // than reading as "never expires", which would misstate the invite.
        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('fails rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(wellFormedArb, fc.constantFrom(...FIELDS), (body, key) => {
        const outcome = settle(
          () => parseGeneratedInvite(throwingAt(body, key)),
          isFullyPopulated,
        );

        // Only the expiry tolerates an absence, so only a throwing expiry parses.
        expect(outcome.ok).toBe(key === 'expiresAt');
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(fc.oneof(anyBodyArb, wellFormedArb), (body) => {
        expect(parseGeneratedInvite(body)).toEqual(parseGeneratedInvite(body));
      }),
      { numRuns: 400 },
    );
  });

  it('never puts an invite secret into a failure reason', () => {
    fc.assert(
      fc.property(
        identityArb,
        fc.constantFrom(
          'https://pitch-mate.co.uk/join/SUPER-SECRET-TOKEN',
          'SUPER-SECRET-TOKEN',
        ),
        fc.constantFrom('inviteId', 'redeemableLink', 'code', 'expiresAt'),
        (inviteId, secret, spoiledKey) => {
          // Every field carries the secret, and one of them is spoiled so the body
          // fails — whichever field failed, the reason must name the label alone.
          const body: Record<string, unknown> = {
            inviteId,
            redeemableLink: secret,
            code: secret,
            expiresAt: '2026-01-01T00:00:00Z',
          };
          body[spoiledKey] = [secret];

          const outcome = settle(
            () => parseGeneratedInvite(body),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            // 4.10: an Invite_Secret in a reason could travel into a log, and the
            // secret cannot be re-read or rotated without generating a new invite.
            expect(outcome.reason).not.toContain(secret);
            expect(outcome.reason).not.toContain('SECRET');
            expect(outcome.reason).toContain(spoiledKey);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
