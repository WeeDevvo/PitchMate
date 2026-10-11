import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isPlayerStatsIdentifier } from './identifiers';
import { type Subject, readSubject, subjectKey } from './subject';

/**
 * Property tests for the Player_Stats_Screen's subject — the `(squadId,
 * membershipId)` pair the screen presents one Player_Profile for — placed beside
 * the module they cover and running well above the 100-iteration floor.
 *
 * Two guarantees are stated here, and the rest of the feature leans on both:
 *
 * - **`readSubject` admits a subject exactly when both identities are well
 *   formed, and carries them through unchanged.** This is the pure half of
 *   Property 31 at the pair level: one malformed identity beside one valid one is
 *   not a partial subject, it is no subject, so no `GetPlayerProfile` call is
 *   worth issuing and the screen presents the concealed not-found (3.3). The
 *   function is also total over the values a route can actually hand over —
 *   absent, empty, malformed — because the screen may not raise on a path a
 *   person typed (1.4).
 * - **`subjectKey` is injective.** The load machine's issue guard is keyed on the
 *   subject rather than on the mount, because a Pairwise_Link navigation keeps
 *   the screen mounted and changes only the parameters. A key collision would
 *   make a navigation to a sibling profile look like a re-render and issue no
 *   call; a spurious key difference would make an unchanged subject re-issue one.
 *   So key equality must hold *exactly when* both identities match (2.4).
 *
 * Both are written as equivalences — `if and only if` — rather than as one-way
 * checks, and the acceptance oracle is spelled out from the stated identity form
 * rather than by reusing the module's own guard, so the two can disagree and a
 * defect shows.
 */

// --- generators ---------------------------------------------------------------

const hexDigitArb = fc.constantFrom(...'0123456789abcdef'.split(''));

const hexRun = (length: number): fc.Arbitrary<string> =>
  fc.string({ unit: hexDigitArb, minLength: length, maxLength: length });

/** The accepted identity form, in lower and upper case. */
const identityArb: fc.Arbitrary<string> = fc
  .tuple(
    hexRun(8),
    hexRun(4),
    hexRun(4),
    hexRun(4),
    hexRun(12),
    fc.boolean(),
  )
  .map(([a, b, c, d, e, upper]) => {
    const identity = `${a}-${b}-${c}-${d}-${e}`;

    return upper ? identity.toUpperCase() : identity;
  });

/** A small pool, so two draws collide often and key equality is exercised. */
const pooledIdentityArb: fc.Arbitrary<string> = fc.constantFrom(
  '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
  '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5c',
  '018F3A2B-4C5D-7E6F-8A9B-0C1D2E3F4A5B', // the first identity, upper-cased
  '2b4c5d6e-7f80-7912-a3b4-c5d6e7f80912',
  '00000000-0000-0000-0000-000000000000',
);

/**
 * Values a route parameter can carry that are **not** identities: absent, empty,
 * the unhyphenated and braced forms, whitespace padding, and arbitrary strings.
 */
const notAnIdentityArb: fc.Arbitrary<string | undefined> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom<string | undefined>(
      undefined,
      '',
      ' ',
      '   ',
      '\t',
      'me',
      'players',
      'undefined',
      'null',
      '018f3a2b4c5d7e6f8a9b0c1d2e3f4a5b', // the 32-digit unhyphenated form
      '{018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b}', // braced
      '(018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b)', // parenthesised
      'urn:uuid:018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
      ' 018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b', // whitespace-padded
      '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b ',
      '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5', // 35 characters
      '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5bc', // 37 characters
      'gggggggg-gggg-gggg-gggg-gggggggggggg', // right shape, not hexadecimal
      '018f3a2b_4c5d_7e6f_8a9b_0c1d2e3f4a5b', // underscore separators
    ),
  },
  {
    weight: 2,
    arbitrary: identityArb.map((identity) => identity.replaceAll('-', '')),
  },
  {
    weight: 2,
    arbitrary: fc.string({ minLength: 0, maxLength: 44 }).filter(
      (text) => !isPlayerStatsIdentifier(text),
    ),
  },
);

/** Either an identity or something that is not one, in roughly equal measure. */
const routeParameterArb: fc.Arbitrary<string | undefined> = fc.oneof(
  { weight: 1, arbitrary: identityArb },
  { weight: 1, arbitrary: notAnIdentityArb },
);

/**
 * An arbitrary pair cast to a `Subject`, used only to state the injectivity of
 * `subjectKey` more strongly than its contract requires: the separator and the
 * length prefix must keep the encoding unique even for strings carrying `/` and
 * `:`, which a valid identity never does.
 */
const arbitraryPairArb: fc.Arbitrary<Subject> = fc.record({
  squadId: fc.oneof(
    { weight: 2, arbitrary: identityArb },
    {
      weight: 3,
      arbitrary: fc.string({
        unit: fc.constantFrom('a', 'b', '/', ':', '-', '0', '1', '36'),
        minLength: 0,
        maxLength: 8,
      }),
    },
  ),
  membershipId: fc.oneof(
    { weight: 2, arbitrary: identityArb },
    {
      weight: 3,
      arbitrary: fc.string({
        unit: fc.constantFrom('a', 'b', '/', ':', '-', '0', '1', '36'),
        minLength: 0,
        maxLength: 8,
      }),
    },
  ),
});

/** The independent oracle, written from the stated identity form. */
function isWellFormed(candidate: unknown): boolean {
  return (
    typeof candidate === 'string' &&
    candidate.length === 36 &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      candidate,
    )
  );
}

// Feature: web-player-stats-screen, Property 31 (pure half): An unidentifiable
// subject is indistinguishable from a concealed absence — a subject is read
// exactly when both route identities are well formed
// Validates: Requirements 1.4, 3.3
describe('readSubject — a subject is read exactly when both identities are well formed', () => {
  it('yields a subject if and only if both parameters are well-formed identities', () => {
    fc.assert(
      fc.property(routeParameterArb, routeParameterArb, (squadId, membershipId) => {
        const expected = isWellFormed(squadId) && isWellFormed(membershipId);

        expect(readSubject(squadId, membershipId) !== null).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it('yields null when either identity alone is malformed, so there is no partial subject', () => {
    fc.assert(
      fc.property(identityArb, notAnIdentityArb, (identity, notAnIdentity) => {
        // 3.3: a valid squad beside a malformed membership is not a subject with
        // one half missing — it is nothing to call for, and it presents exactly
        // as a concealed absence does.
        expect(readSubject(notAnIdentity, identity)).toBeNull();
        expect(readSubject(identity, notAnIdentity)).toBeNull();
        expect(readSubject(notAnIdentity, notAnIdentity)).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it('carries both identities through unchanged, trimming and folding nothing', () => {
    fc.assert(
      fc.property(identityArb, identityArb, (squadId, membershipId) => {
        const subject = readSubject(squadId, membershipId);

        // 1.4: the value the route carried is the value the call is issued for.
        // A repaired identity would mean requesting a profile nobody asked for.
        expect(subject).toEqual({ squadId, membershipId });
        expect(subject?.squadId).toBe(squadId);
        expect(subject?.membershipId).toBe(membershipId);
      }),
      { numRuns: 500 },
    );
  });

  it('does not reorder the two parameters', () => {
    fc.assert(
      fc.property(
        identityArb,
        identityArb,
        (first, second) => {
          // A transposed read would scope every statistic to the wrong squad
          // while still rendering a profile, which is the one failure mode worse
          // than rendering nothing.
          expect(readSubject(first, second)?.squadId).toBe(first);
          expect(readSubject(first, second)?.membershipId).toBe(second);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is total over absent, empty, and malformed parameters of any value', () => {
    fc.assert(
      fc.property(
        fc.anything({ maxDepth: 2 }),
        fc.anything({ maxDepth: 2 }),
        (squadId, membershipId) => {
          // The declared parameter types describe what `react-router` hands
          // over; the screen must not raise for anything that reaches it at
          // runtime either (1.4).
          const subject = readSubject(
            squadId as string | undefined,
            membershipId as string | undefined,
          );

          expect(subject === null || typeof subject === 'object').toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('is deterministic across repeated reads', () => {
    fc.assert(
      fc.property(routeParameterArb, routeParameterArb, (squadId, membershipId) => {
        expect(readSubject(squadId, membershipId)).toEqual(
          readSubject(squadId, membershipId),
        );
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-player-stats-screen, Property 30 (pure half): One call per
// subject — two subjects share a key exactly when both identities match
// Validates: Requirements 2.4
describe('subjectKey — key equality holds exactly when identity equality holds', () => {
  it('yields equal keys if and only if both identities are equal', () => {
    fc.assert(
      fc.property(
        pooledIdentityArb,
        pooledIdentityArb,
        pooledIdentityArb,
        pooledIdentityArb,
        (leftSquad, leftMembership, rightSquad, rightMembership) => {
          const left: Subject = { squadId: leftSquad, membershipId: leftMembership };
          const right: Subject = { squadId: rightSquad, membershipId: rightMembership };

          const sameIdentity =
            leftSquad === rightSquad && leftMembership === rightMembership;

          // Both directions from one generator: the pool collides often enough
          // that equal pairs and unequal pairs both occur in volume (2.4).
          expect(subjectKey(left) === subjectKey(right)).toBe(sameIdentity);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('distinguishes identities that differ only in letter case', () => {
    fc.assert(
      fc.property(identityArb, identityArb, (squadId, membershipId) => {
        const lower: Subject = {
          squadId: squadId.toLowerCase(),
          membershipId: membershipId.toLowerCase(),
        };
        const upper: Subject = {
          squadId: squadId.toUpperCase(),
          membershipId: membershipId.toUpperCase(),
        };

        // Identity equality is string equality: this feature never folds an
        // identity's case, so neither may its key.
        expect(subjectKey(lower) === subjectKey(upper)).toBe(
          lower.squadId === upper.squadId &&
            lower.membershipId === upper.membershipId,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('distinguishes a subject from its transposition unless both identities match', () => {
    fc.assert(
      fc.property(pooledIdentityArb, pooledIdentityArb, (first, second) => {
        const subject: Subject = { squadId: first, membershipId: second };
        const transposed: Subject = { squadId: second, membershipId: first };

        expect(subjectKey(subject) === subjectKey(transposed)).toBe(first === second);
      }),
      { numRuns: 300 },
    );
  });

  it('stays injective even for pairs carrying the key\u2019s own separators', () => {
    fc.assert(
      fc.property(arbitraryPairArb, arbitraryPairArb, (left, right) => {
        const sameIdentity =
          left.squadId === right.squadId && left.membershipId === right.membershipId;

        // Injectivity does not rest on the identities being well formed: the
        // squad identity's length is written ahead of it, so no pair of strings
        // can share a key by splitting at a different place.
        expect(subjectKey(left) === subjectKey(right)).toBe(sameIdentity);
      }),
      { numRuns: 1000 },
    );
  });

  it('is a non-empty string, deterministic, and raises nothing', () => {
    fc.assert(
      fc.property(arbitraryPairArb, (subject) => {
        const key = subjectKey(subject);

        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
        expect(subjectKey(subject)).toBe(key);
      }),
      { numRuns: 500 },
    );
  });

  it('keys a subject read from the route, carrying both identities in the key', () => {
    fc.assert(
      fc.property(identityArb, identityArb, (squadId, membershipId) => {
        const subject = readSubject(squadId, membershipId);

        expect(subject).not.toBeNull();

        const key = subjectKey(subject as Subject);

        // The key is an internal comparison value, never user-facing copy; it is
        // readable so a failing machine test names the subject it was holding.
        expect(key).toContain(squadId);
        expect(key).toContain(membershipId);
      }),
      { numRuns: 300 },
    );
  });
});
