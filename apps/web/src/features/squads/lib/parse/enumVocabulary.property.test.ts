import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  INVITE_STATE_NAMES,
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  REDEEM_OUTCOME_NAMES,
  SQUAD_FEATURE_NAMES,
  SQUAD_ROLE_NAMES,
} from '../wireEnums';
import { parseFeatureFlag } from './featureFlags';
import { parseInviteSummary } from './inviteSummary';
import { ok, printInstant, type ParseResult } from './primitives';
import { parseRedemption } from './redemption';
import { parseSquadDetail } from './squadDetail';
import { parseSquadSummary } from './squadSummary';

/**
 * Property test for the vocabulary the Response_Parsers accept in an
 * enum-valued field, placed beside the modules it covers and running well above
 * the 100-iteration floor.
 *
 * This file carries **Property 24: Enum-valued fields accept exactly the
 * generated vocabulary** — for any enum-valued field of a parsed body, any
 * member name of that field's Generated_Enum_Union is accepted and any string
 * outside that union is rejected (Requirement 12.8).
 *
 * The parsers used to read these fields as numbers through a hand-kept code
 * table, and the failure mode that motivated 12.8 was not a rejected body but a
 * *silently wrong* one: a table whose order disagreed with the backend's
 * declaration mapped a field to the wrong **valid** member, so a guest read as an
 * owner and nothing anywhere said so. "Exactly the generated vocabulary" is the
 * claim that replaces that table, and it needs both halves — a vocabulary that
 * accepted too little would fail bodies the backend legitimately sends, and one
 * that accepted too much would let a value nobody declared reach a rendered
 * screen.
 *
 * Four things about how this is written matter more than the run counts.
 *
 * **The enum-valued fields are data, not prose.** {@link ENUM_FIELD_CASES} pairs
 * each parser with each of its enum-valued fields, that field's generated name
 * tuple, and a way to build an otherwise-well-formed body carrying a candidate
 * in that field. The property is stated once in {@link describeEnumField} and run
 * per entry, so a field whose reading drifted cannot hide behind a sibling field
 * that still validates.
 *
 * **The accepted vocabulary is read, never restated.** Every acceptance
 * generator draws from the name tuples of `lib/wireEnums.ts` — the feature's
 * single declaration of each union, itself pinned to the Committed_Types from
 * both directions at compile time (12.2, 12.3). A member name written as a
 * literal here would prove something about this file instead of about the
 * generated union, so there is not one in an acceptance position: even the
 * *filler* values that keep the rest of a body well-formed are taken from the
 * tuples rather than typed out.
 *
 * **The near-misses, by contrast, must be literals.** A generator filtered by
 * the very predicate under test can show that *some* outside string is rejected;
 * it cannot show that a *particular* wrong value is. So each entry names the
 * values this field used to carry and the values a careless producer would send
 * it: the retired numeric codes, including the `0`-based ones of `RedeemOutcome`
 * that a 1-based table misread, and the retired lower-case and kebab spellings
 * the feature's own code table used before the enums travelled by name.
 *
 * **A rejection is attributed to the field.** The body around the candidate is
 * fixed and valid — established by the acceptance direction, which parses that
 * same body with a real member name in the same position — and each rejection
 * additionally asserts the failure reason names *this* field. Without that, a
 * body that failed for an unrelated reason would satisfy "rejected" and the
 * property would hold for a parser that rejected everything.
 *
 * `null` and `undefined` are deliberately **not** among the near-misses. Four of
 * these eight fields treat an absence as a valid parsed absence rather than a
 * mismatch (Requirement 16.8), so an absence is a different rule with its own
 * coverage in each module's own tests; this property is about the *present*
 * value.
 *
 * React-free and DOM-free like every module under `lib/`.
 *
 * Requirements: 12.8
 */

/* -------------------------------------------------------------------------- */
/* Fixed, valid surroundings for the field under test                         */
/* -------------------------------------------------------------------------- */

/**
 * An identity in the 36-character hyphenated form `lib/identifiers.ts` accepts,
 * for every identity-valued property of the bodies below. One value is enough:
 * nothing here is a property of identities, and a fixed valid one keeps a
 * rejection attributable to the enum field.
 */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/**
 * A valid instant for the `createdAt` an invite summary requires, printed by the
 * module that reads it back rather than spelled out — so this file carries no
 * assumption about the accepted instant syntax that could fail an invite-summary
 * body for a reason unrelated to its state field.
 */
const WELL_FORMED_INSTANT = printInstant(0);

/** A squad summary carrying `candidate` as its Member_Role. */
function squadSummaryWithRole(candidate: unknown): unknown {
  return {
    squadId: WELL_FORMED_IDENTITY,
    name: 'Thursday Nights',
    role: candidate,
    // A filler read from the generated vocabulary, not typed out as a literal.
    state: MEMBERSHIP_STATE_NAMES[0],
  };
}

/** A squad summary carrying `candidate` as its Membership_State. */
function squadSummaryWithState(candidate: unknown): unknown {
  return {
    squadId: WELL_FORMED_IDENTITY,
    name: 'Thursday Nights',
    role: SQUAD_ROLE_NAMES[0],
    state: candidate,
  };
}

/**
 * One well-formed squad member, with `overrides` replacing the field under test.
 *
 * Every enum-valued property defaults to a name read from its own generated
 * tuple, so a member built here parses unless the override is the thing that
 * fails it.
 */
function squadMember(overrides: Readonly<Record<string, unknown>>): unknown {
  return {
    membershipId: WELL_FORMED_IDENTITY,
    displayName: 'Dave',
    role: SQUAD_ROLE_NAMES[0],
    state: MEMBERSHIP_STATE_NAMES[0],
    isGuest: false,
    appearances: 0,
    ratingState: RATING_STATE_NAMES[0],
    ...overrides,
  };
}

/**
 * A squad detail whose single member carries `candidate` in the named property.
 *
 * `features` is empty: the Feature_Flag's own enum-valued field has its own entry
 * in the table, and an empty collection keeps a member-field rejection
 * attributable to the member.
 */
function squadDetailWithMemberField(
  property: string,
  candidate: unknown,
): unknown {
  return {
    squadId: WELL_FORMED_IDENTITY,
    name: 'Thursday Nights',
    members: [squadMember({ [property]: candidate })],
    features: [],
  };
}

/** A feature flag carrying `candidate` as its Feature_Flag. */
function featureFlagWithFeature(candidate: unknown): unknown {
  return { feature: candidate, isEnabled: true };
}

/** An invite summary carrying `candidate` as its Invite_State. */
function inviteSummaryWithState(candidate: unknown): unknown {
  return {
    inviteId: WELL_FORMED_IDENTITY,
    state: candidate,
    createdAt: WELL_FORMED_INSTANT,
    createdBy: null,
    expiresAt: null,
  };
}

/** A redemption carrying `candidate` as its Redeem_Outcome. */
function redemptionWithOutcome(candidate: unknown): unknown {
  return {
    membershipId: WELL_FORMED_IDENTITY,
    outcome: candidate,
    squadId: WELL_FORMED_IDENTITY,
  };
}

/* -------------------------------------------------------------------------- */
/* The table: one entry per enum-valued field of a parsed body                */
/* -------------------------------------------------------------------------- */

/**
 * One enum-valued field, reduced to what the property needs: the vocabulary it
 * must accept, a body that carries a candidate in it, and a reading that yields
 * the parsed field itself.
 *
 * The parsed type is erased by {@link enumFieldCase} so the entries can sit in
 * one table without a cast at the use site and without `any` anywhere.
 */
interface EnumFieldCase {
  /** The field, as the test titles name it. */
  readonly label: string;
  /** The field's generated vocabulary, read from `lib/wireEnums.ts`. */
  readonly names: readonly [string, ...string[]];
  /** The label the parser gives this field in a failure reason. */
  readonly fieldLabel: string;
  /** An otherwise-well-formed body carrying `candidate` in this field. */
  readonly buildBody: (candidate: unknown) => unknown;
  /** Parses such a body and projects this field out of the parsed value. */
  readonly readEnumField: (body: unknown) => ParseResult<unknown>;
  /**
   * Values this field must reject, stated as literals: the retired numeric
   * codes and the retired lower-case or kebab spellings.
   */
  readonly nearMisses: readonly unknown[];
}

/**
 * One table entry, with the parser's own parsed type inferred and then erased.
 *
 * The projection runs only on a successful parse, and a failure is passed
 * through unchanged so the reason stays available to the rejection assertions.
 */
function enumFieldCase<TParsed>(entry: {
  readonly label: string;
  readonly names: readonly [string, ...string[]];
  readonly fieldLabel: string;
  readonly buildBody: (candidate: unknown) => unknown;
  readonly parse: (body: unknown) => ParseResult<TParsed>;
  readonly project: (parsed: TParsed) => unknown;
  readonly nearMisses: readonly unknown[];
}): EnumFieldCase {
  return {
    label: entry.label,
    names: entry.names,
    fieldLabel: entry.fieldLabel,
    buildBody: entry.buildBody,
    nearMisses: entry.nearMisses,
    readEnumField: (body) => {
      const parsed = entry.parse(body);

      return parsed.ok ? ok(entry.project(parsed.value)) : parsed;
    },
  };
}

/**
 * The retired numeric codes, as every migrated field used to carry them.
 *
 * Shared because the set is small and the union of all six code tables is what a
 * stale producer could send to any of these fields: the four explicitly-valued
 * enums were 1-based, while `SkillTier` and `RedeemOutcome` declared no values
 * and started at `0` — which is exactly the asymmetry a single hand-kept table
 * got wrong. `3` is here because a 1-based misreading of a 0-based enum would
 * have named it. The string forms are included because a producer that
 * serialised the code as text is no closer to a name than one that sent a number.
 */
const RETIRED_CODES: readonly unknown[] = [-1, 0, 1, 2, 3, 4, '0', '1', '2', '3'];

const ENUM_FIELD_CASES: readonly EnumFieldCase[] = [
  enumFieldCase({
    label: 'squadSummary — role',
    names: SQUAD_ROLE_NAMES,
    fieldLabel: 'squad summary role',
    buildBody: squadSummaryWithRole,
    parse: parseSquadSummary,
    project: (summary) => summary.role,
    nearMisses: [
      ...RETIRED_CODES,
      // The feature's own retired spellings of this union.
      'owner',
      'admin',
      'member',
      // Plausible mis-cases, and a member of a different union.
      'OWNER',
      'Owners',
      'Captain',
      'Active',
    ],
  }),
  enumFieldCase({
    label: 'squadSummary — state',
    names: MEMBERSHIP_STATE_NAMES,
    fieldLabel: 'squad summary state',
    buildBody: squadSummaryWithState,
    parse: parseSquadSummary,
    project: (summary) => summary.state,
    nearMisses: [
      ...RETIRED_CODES,
      'active',
      'inactive',
      'ACTIVE',
      'Left',
      // A member of `InviteState`, which shares two spellings with this union
      // and must not lend it a third.
      'Revoked',
    ],
  }),
  enumFieldCase({
    label: 'squadDetail — member role',
    names: SQUAD_ROLE_NAMES,
    fieldLabel: 'squad member role',
    buildBody: (candidate) => squadDetailWithMemberField('role', candidate),
    parse: parseSquadDetail,
    project: (detail) => detail.members[0]?.role,
    nearMisses: [...RETIRED_CODES, 'owner', 'admin', 'member', 'Guest', 'Active'],
  }),
  enumFieldCase({
    label: 'squadDetail — member state',
    names: MEMBERSHIP_STATE_NAMES,
    fieldLabel: 'squad member state',
    buildBody: (candidate) => squadDetailWithMemberField('state', candidate),
    parse: parseSquadDetail,
    project: (detail) => detail.members[0]?.state,
    nearMisses: [...RETIRED_CODES, 'active', 'inactive', 'Removed', 'Expired'],
  }),
  enumFieldCase({
    label: 'squadDetail — member ratingState',
    names: RATING_STATE_NAMES,
    fieldLabel: 'squad member ratingState',
    buildBody: (candidate) => squadDetailWithMemberField('ratingState', candidate),
    parse: parseSquadDetail,
    project: (detail) => detail.members[0]?.ratingState,
    nearMisses: [
      ...RETIRED_CODES,
      // This signal never travelled as a code, but it is spelled in lower case
      // and in kebab case all over the UI vocabulary, so both are worth pinning.
      'provisional',
      'established',
      'provisional-rating',
      'Settled',
      'Unrated',
    ],
  }),
  enumFieldCase({
    label: 'featureFlags — feature',
    names: SQUAD_FEATURE_NAMES,
    fieldLabel: 'feature flag feature',
    buildBody: featureFlagWithFeature,
    parse: parseFeatureFlag,
    project: (flag) => flag.feature,
    nearMisses: [
      ...RETIRED_CODES,
      // The retired kebab spelling of the one feature, plus the other casings a
      // producer might reach for.
      'live-match-tracking',
      'livematchtracking',
      'liveMatchTracking',
      'LIVE_MATCH_TRACKING',
      'LiveTracking',
    ],
  }),
  enumFieldCase({
    label: 'inviteSummary — state',
    names: INVITE_STATE_NAMES,
    fieldLabel: 'invite summary state',
    buildBody: inviteSummaryWithState,
    parse: parseInviteSummary,
    project: (summary) => summary.state,
    nearMisses: [
      ...RETIRED_CODES,
      'active',
      'revoked',
      'expired',
      'EXPIRED',
      'Used',
      // A member of `MembershipState` that this union does not declare.
      'Inactive',
    ],
  }),
  enumFieldCase({
    label: 'redemption — outcome',
    names: REDEEM_OUTCOME_NAMES,
    fieldLabel: 'redemption outcome',
    buildBody: redemptionWithOutcome,
    parse: parseRedemption,
    project: (redemption) => redemption.outcome,
    nearMisses: [
      ...RETIRED_CODES,
      'joined',
      'reactivated',
      // The retired kebab spelling of the outcome whose 0-based numbering made
      // the old code table the most dangerous reading in the feature.
      'already-member',
      'alreadyMember',
      'ALREADY_MEMBER',
      'Rejoined',
    ],
  }),
];

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/** Every name of every union these parsers read, as a cross-union pool. */
const ALL_WIRE_ENUM_NAMES: readonly string[] = [
  ...SQUAD_ROLE_NAMES,
  ...MEMBERSHIP_STATE_NAMES,
  ...RATING_STATE_NAMES,
  ...SQUAD_FEATURE_NAMES,
  ...INVITE_STATE_NAMES,
  ...REDEEM_OUTCOME_NAMES,
];

/**
 * A string outside `names`.
 *
 * Weighted towards the strings a real producer could send rather than towards
 * random noise: case variants and whitespace-padded forms of the union's own
 * names, truncations and extensions of them, and names belonging to a *different*
 * union — the last of which is the interesting one, since it is a perfectly valid
 * Wire_Enum_Name and still has no business in this field.
 *
 * The filter is the union's own membership, so this generator cannot accidentally
 * emit a member and report a parser defect that is not there. It is also why the
 * literal near-misses exist: a generator constrained by the predicate under test
 * cannot demonstrate that one *specific* wrong value is rejected.
 */
function outsideUnionArb(names: readonly string[]): fc.Arbitrary<string> {
  const variants = names.flatMap((name) => [
    name.toLowerCase(),
    name.toUpperCase(),
    ` ${name}`,
    `${name} `,
    `${name}\u0000`,
    `${name}s`,
    name.slice(0, -1),
    `${name}${name}`,
  ]);

  return fc
    .oneof(
      { weight: 4, arbitrary: fc.string({ maxLength: 24 }) },
      { weight: 4, arbitrary: fc.constantFrom(...variants) },
      { weight: 2, arbitrary: fc.constantFrom(...ALL_WIRE_ENUM_NAMES) },
      { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 8 }) },
    )
    .filter((candidate) => !names.includes(candidate));
}

/* -------------------------------------------------------------------------- */
/* The property, stated once and run per enum-valued field                    */
/* -------------------------------------------------------------------------- */

/**
 * The reason a reading that must have failed gave, for the rejection assertions.
 */
function reasonOf(parsed: ParseResult<unknown>): string {
  return parsed.ok ? '' : parsed.reason;
}

/** The clause `readWireEnumName` composes for a field it could not read. */
function rejectionReason(fieldLabel: string): string {
  return `${fieldLabel} names no member of its wire enum`;
}

/**
 * Property 24 for one enum-valued field.
 *
 * @param fieldCase the field, its generated vocabulary, and its body builder
 * @param numRuns iterations, well above the 100-iteration floor
 */
function describeEnumField(fieldCase: EnumFieldCase, numRuns = 400): void {
  // Feature: api-response-contracts, Property 24: Enum-valued fields accept exactly the generated vocabulary
  // Validates: Requirements 12.8
  describe(`the accepted enum vocabulary — ${fieldCase.label}`, () => {
    it('accepts every member name of its generated union, unchanged', () => {
      // Stated over the whole tuple first, so every member is certainly
      // exercised rather than left to the sampler. A union whose members the
      // parser only *mostly* accepted would fail here on the member it dropped.
      for (const name of fieldCase.names) {
        const parsed = fieldCase.readEnumField(fieldCase.buildBody(name));

        expect(parsed.ok, `${name} was rejected: ${reasonOf(parsed)}`).toBe(true);
      }

      fc.assert(
        fc.property(fc.constantFrom(...fieldCase.names), (name) => {
          const parsed = fieldCase.readEnumField(fieldCase.buildBody(name));

          // 12.8: the accepted vocabulary is the generated union's, read from
          // `lib/wireEnums.ts` rather than restated here — so this assertion is
          // a statement about the Committed_Types, not about this file.
          expect(parsed.ok).toBe(true);
          // `Object.is`, not loose equality: the name must arrive on the parsed
          // value as the very value the wire carried. A parser that case-folded
          // it, interned it through a code table, or substituted a default would
          // satisfy a truthiness check and fail this one.
          expect(parsed.ok && Object.is(parsed.value, name)).toBe(true);
        }),
        { numRuns },
      );
    });

    it('rejects any string outside that union', () => {
      fc.assert(
        fc.property(outsideUnionArb(fieldCase.names), (candidate) => {
          const parsed = fieldCase.readEnumField(fieldCase.buildBody(candidate));

          // 12.8, 12.7: a value naming no member is a contract mismatch, and it
          // fails the body carrying it rather than being defaulted, dropped, or
          // coerced into a plausible member.
          expect(parsed.ok).toBe(false);
          // And it fails *for this field*. Without this the property would be
          // satisfied by a parser that rejected every body for any reason — the
          // acceptance direction above parses this same body with a real member
          // name in this same position, so the field is the only difference.
          expect(reasonOf(parsed)).toContain(
            rejectionReason(fieldCase.fieldLabel),
          );
        }),
        { numRuns },
      );
    });

    it('rejects the retired codes and spellings this field used to carry', () => {
      // Literals, because a generator filtered by the predicate under test can
      // show that *some* outside value is rejected but not that a *particular*
      // one is. These are the values the previous contract sent for this very
      // field, and the lower-case and kebab spellings the retired code table
      // used, so a parser that quietly kept reading either would fail here.
      for (const candidate of fieldCase.nearMisses) {
        const parsed = fieldCase.readEnumField(fieldCase.buildBody(candidate));

        expect(
          parsed.ok,
          `${String(candidate)} was accepted by ${fieldCase.label}`,
        ).toBe(false);
        expect(reasonOf(parsed)).toContain(rejectionReason(fieldCase.fieldLabel));
      }
    });
  });
}

for (const fieldCase of ENUM_FIELD_CASES) {
  describeEnumField(fieldCase);
}

/* -------------------------------------------------------------------------- */
/* The non-vacuity floor                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The property above quantifies over {@link ENUM_FIELD_CASES}, so the table is
 * the quantifier: an entry silently lost would leave the property *true* over a
 * smaller domain and every test green. These assertions put a floor under the
 * domain, so losing a field fails rather than passes on fewer cases.
 */
// Feature: api-response-contracts, Property 24: Enum-valued fields accept exactly the generated vocabulary
// Validates: Requirements 12.8
describe('the accepted enum vocabulary — the table is the quantifier', () => {
  it('covers every enum-valued field of the squads response bodies', () => {
    // The squads parsers carry eight enum-valued fields across five bodies:
    // `squadSummary` role and state, `squadDetail` member role, state, and
    // ratingState, `featureFlags` feature, `inviteSummary` state, and
    // `redemption` outcome. `leaderboard`, `generatedInvite`, `invitePreview`,
    // `createdSquad`, and `createdGuest` carry none.
    expect(ENUM_FIELD_CASES.length).toBeGreaterThanOrEqual(7);

    const labels = ENUM_FIELD_CASES.map((fieldCase) => fieldCase.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toStrictEqual([
      'squadSummary — role',
      'squadSummary — state',
      'squadDetail — member role',
      'squadDetail — member state',
      'squadDetail — member ratingState',
      'featureFlags — feature',
      'inviteSummary — state',
      'redemption — outcome',
    ]);
  });

  it('reaches all six unions the squads parsers read', () => {
    // Field count alone would be satisfied by eight entries over one union. The
    // six unions below are the ones reachable from a squads response body;
    // `SkillTier` is a *request* enum and `LeaderboardStatistic` is echoed and
    // disregarded, so neither appears in a parsed body.
    const unions = new Set(
      ENUM_FIELD_CASES.map((fieldCase) => fieldCase.names.join('|')),
    );

    expect(unions.size).toBe(6);
  });

  it('asserts acceptance over a non-trivial number of member names', () => {
    // Every acceptance assertion is driven by a name tuple, so an emptied tuple
    // would make the acceptance direction vacuous while still looking covered.
    // The tuples are non-empty by construction in `lib/wireEnums.ts`; this is
    // the runtime floor that makes the *total* non-trivial.
    const covered = ENUM_FIELD_CASES.reduce(
      (total, fieldCase) => total + fieldCase.names.length,
      0,
    );

    for (const fieldCase of ENUM_FIELD_CASES) {
      expect(fieldCase.names.length).toBeGreaterThan(0);
    }

    expect(covered).toBeGreaterThanOrEqual(19);
  });

  it('states a near-miss for every field, and generates an outside string for every union', () => {
    for (const fieldCase of ENUM_FIELD_CASES) {
      // A field with no literal near-miss would be covered by the filtered
      // generator alone, which is the half of the rejection claim that cannot
      // name a specific wrong value.
      expect(fieldCase.nearMisses.length).toBeGreaterThanOrEqual(10);

      // And the generator has to be able to produce something: a filter that
      // excluded everything would leave the rejection direction untested on a
      // union whose names happened to cover the whole pool.
      const samples = fc.sample(outsideUnionArb(fieldCase.names), 20);

      expect(samples.length).toBe(20);
      expect(
        samples.every((candidate) => !fieldCase.names.includes(candidate)),
      ).toBe(true);
    }
  });
});
