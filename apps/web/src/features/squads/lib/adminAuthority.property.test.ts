import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { resolveAdminAuthority } from './adminAuthority';
import type { MemberRole, MembershipStateValue } from './enumCodes';
import type { SquadSummary } from './parse/squadSummary';
import type { SquadMember } from './parse/squadDetail';

/**
 * Property tests for the one pure function the whole admin surface hangs off,
 * beside the module they cover as the design's Testing Strategy asks, and running
 * well above the 100-iteration floor (Requirements 20.1, 20.9).
 *
 * The input space here is *finite and tiny* — a role in {owner, admin, member,
 * absent} against a state in {active, inactive, absent}, twelve combinations, or
 * twenty once `null` and `undefined` are distinguished as two spellings of
 * absence. So these tests do something the larger properties in this feature
 * cannot: they enumerate the space exhaustively **and** generate over it. The
 * enumeration is what makes the claim total (Requirement 20.9 asks for "every
 * combination", and sampling twenty cases at random cannot promise it); the
 * generated runs are what keep the property honest as a property, and what would
 * catch an argument-order or argument-count change that the enumerated table
 * happened to agree with.
 *
 * Four claims are made:
 *
 * - **The accepted set is exactly `active` × {owner, admin}.** Stated against an
 *   independently written oracle — a literal set of the two accepted pairs, read
 *   off Requirement 10.1 rather than derived from the two comparisons the module
 *   makes — and cross-checked by counting: of the twenty combinations, exactly
 *   two are accepted, and both name an active owner or an active admin.
 * - **Absence is never a default.** An absent role with an active state is
 *   `false`, an absent state with an owner role is `false`, and `null` and
 *   `undefined` are interchangeable in both positions. This is the shape
 *   Requirement 6.10 needs: an unidentified caller reaches this function as a pair
 *   of absences and is answered without a special branch anywhere.
 * - **The unidentified caller holds no authority.** Driven through a harness that
 *   resolves the pair the way the screens do — the `GetSquad` member matching the
 *   caller's membership identity if there is one, else the `ListMySquads` summary
 *   for the squad, else nothing — over generated collections that deliberately
 *   contain neither. Requirement 6.10 is a claim about that *resolution*, so
 *   testing it needs the lookup, not just the two absent arguments.
 * - **The function is pure and total.** Every one of the twenty combinations
 *   returns a `boolean` primitive, never throws, and repeated calls agree.
 *
 * What is deliberately **not** claimed here: that the Admin_Section is rendered
 * exactly while this returns `true` (Property 26, at the rendering site), that a
 * row's Promotion_Control follows (Property 27), or that the backend permits
 * anything. Requirement 10.5 keeps authorisation server-side; this function
 * decides only what is drawn.
 */

// --- the input space ---------------------------------------------------------

/** Every Member_Role the Enum_Code_Map names, plus both spellings of absence. */
const ROLE_CASES: readonly (MemberRole | null | undefined)[] = [
  'owner',
  'admin',
  'member',
  null,
  undefined,
];

/** Every Membership_State the Enum_Code_Map names, plus both spellings of absence. */
const STATE_CASES: readonly (MembershipStateValue | null | undefined)[] = [
  'active',
  'inactive',
  null,
  undefined,
];

interface AuthorityCase {
  readonly role: MemberRole | null | undefined;
  readonly state: MembershipStateValue | null | undefined;
}

/** The full cross product: five roles by four states, twenty combinations. */
const ALL_CASES: readonly AuthorityCase[] = ROLE_CASES.flatMap((role) =>
  STATE_CASES.map((state) => ({ role, state })),
);

/** A readable name for a combination, used in failure output. */
function describeCase({ role, state }: AuthorityCase): string {
  return `role=${String(role)} state=${String(state)}`;
}

// --- the oracle --------------------------------------------------------------

/**
 * The accepted set written straight out of Requirement 10.1 — "the Membership_State
 * is active and the Member_Role is owner or admin" — as two literal pairs rather
 * than as a pair of comparisons. A restatement of the module's `state !== 'active'`
 * / `role === 'owner' || role === 'admin'` body would agree with an inverted
 * comparison; a literal enumeration cannot.
 */
const ACCEPTED_PAIRS: ReadonlySet<string> = new Set([
  'owner|active',
  'admin|active',
]);

/** Whether Requirement 10.1 accepts this combination. */
function oracleAuthority({ role, state }: AuthorityCase): boolean {
  return ACCEPTED_PAIRS.has(`${String(role)}|${String(state)}`);
}

// --- generators --------------------------------------------------------------

const roleArb: fc.Arbitrary<MemberRole | null | undefined> = fc.constantFrom(
  ...ROLE_CASES,
);

const stateArb: fc.Arbitrary<MembershipStateValue | null | undefined> =
  fc.constantFrom(...STATE_CASES);

const caseArb: fc.Arbitrary<AuthorityCase> = fc.record({
  role: roleArb,
  state: stateArb,
});

/** A role that carries authority when the membership is active. */
const authoritativeRoleArb: fc.Arbitrary<MemberRole> = fc.constantFrom(
  'owner' as const,
  'admin' as const,
);

/** Absence in either spelling, for the interchangeability claims. */
const absenceArb: fc.Arbitrary<null | undefined> = fc.constantFrom(null, undefined);

// --- the unidentified-caller harness ----------------------------------------

/**
 * How a screen arrives at the pair this function takes (Requirement 6.10): the
 * `GetSquad` member whose membership identity is the caller's own, falling back to
 * the `ListMySquads` summary for the squad, and to nothing when neither identifies
 * the caller. The fallback is whole-record rather than field-by-field, so a
 * guest's absent role is never quietly topped up from a summary.
 */
function resolveAuthorityForCaller(
  summaries: readonly SquadSummary[],
  members: readonly SquadMember[],
  squadId: string,
  callerMembershipId: string | null,
): boolean {
  const ownMember =
    callerMembershipId === null
      ? undefined
      : members.find((member) => member.membershipId === callerMembershipId);
  const ownSummary = summaries.find((summary) => summary.squadId === squadId);
  const identified = ownMember ?? ownSummary;

  return resolveAdminAuthority(identified?.role, identified?.state);
}

/** A Squad_Summary with generated membership fields, absences included. */
const summaryArb = (squadIdArb: fc.Arbitrary<string>): fc.Arbitrary<SquadSummary> =>
  fc.record({
    squadId: squadIdArb,
    name: fc.string({ minLength: 0, maxLength: 24 }),
    role: fc.constantFrom('owner' as const, 'admin' as const, 'member' as const, null),
    state: fc.constantFrom('active' as const, 'inactive' as const, null),
  });

/** A Squad_Member with generated role, state, and Guest_Flag. */
const memberArb = (
  membershipIdArb: fc.Arbitrary<string>,
): fc.Arbitrary<SquadMember> =>
  fc.record({
    membershipId: membershipIdArb,
    displayName: fc.string({ minLength: 0, maxLength: 24 }),
    role: fc.constantFrom('owner' as const, 'admin' as const, 'member' as const, null),
    state: fc.constantFrom('active' as const, 'inactive' as const),
    isGuest: fc.boolean(),
  });

/**
 * A squad identity, a caller membership identity, and collections that mention
 * **neither** — the shape of the case Requirement 6.10 names, where the squads
 * listing has not been loaded (or does not carry this squad) and no member of the
 * squad detail is the caller.
 */
const unidentifiedCallerArb = fc
  .tuple(fc.uuid(), fc.uuid())
  .chain(([squadId, callerMembershipId]) =>
    fc.record({
      squadId: fc.constant(squadId),
      callerMembershipId: fc.constantFrom(callerMembershipId, null),
      summaries: fc
        .array(summaryArb(fc.uuid()), { maxLength: 8 })
        .map((summaries) =>
          summaries.filter((summary) => summary.squadId !== squadId),
        ),
      members: fc
        .array(memberArb(fc.uuid()), { maxLength: 8 })
        .map((members) =>
          members.filter((member) => member.membershipId !== callerMembershipId),
        ),
    }),
  );

// Feature: web-squads-screens, Property 25: Admin_Authority holds for exactly the
// active owner or admin
// Validates: Requirements 10.1, 20.9
describe('resolveAdminAuthority — the accepted set is exactly the active owner or admin', () => {
  it('agrees with the accepted set of Requirement 10.1 on every generated combination', () => {
    fc.assert(
      fc.property(caseArb, (authorityCase) => {
        // The oracle is a literal set of accepted pairs, so this is the criterion
        // checked rather than the implementation restated.
        expect(resolveAdminAuthority(authorityCase.role, authorityCase.state)).toBe(
          oracleAuthority(authorityCase),
        );
      }),
      { numRuns: 500 },
    );
  });

  it('accepts exactly two of the twenty combinations, and names which two', () => {
    const accepted = ALL_CASES.filter(({ role, state }) =>
      resolveAdminAuthority(role, state),
    );

    // Exhaustive, so "exactly" is a fact about the whole space and not a sample:
    // twenty combinations in, two out.
    expect(ALL_CASES).toHaveLength(20);
    expect(accepted.map(describeCase)).toEqual([
      'role=owner state=active',
      'role=admin state=active',
    ]);
  });

  it('returns the oracle answer for every combination in the space, enumerated', () => {
    for (const authorityCase of ALL_CASES) {
      expect({
        combination: describeCase(authorityCase),
        authority: resolveAdminAuthority(authorityCase.role, authorityCase.state),
      }).toEqual({
        combination: describeCase(authorityCase),
        authority: oracleAuthority(authorityCase),
      });
    }
  });

  it('holds for an active owner and an active admin', () => {
    fc.assert(
      fc.property(authoritativeRoleArb, (role) => {
        expect(resolveAdminAuthority(role, 'active')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('refuses a plain member however active the membership is', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        // 10.1: `member` is rejected by the role test, so no state rescues it — a
        // plain member administers nothing.
        expect(resolveAdminAuthority('member', state)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('refuses an inactive membership whatever role it retains', () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        // An inactive membership keeps its role for history and replay, so an
        // inactive owner still parses as an owner. The state test is what stops a
        // removed owner from administering the squad they left.
        expect(resolveAdminAuthority(role, 'inactive')).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 25: Admin_Authority holds for exactly the
// active owner or admin
// Validates: Requirements 6.10, 10.1, 20.9
describe('resolveAdminAuthority — an absent role or state is a decision, not a default', () => {
  it('refuses an absent role however active the membership is', () => {
    fc.assert(
      fc.property(absenceArb, stateArb, (absentRole, state) => {
        // A guest membership carries no role at all (16.8), and an unidentified
        // caller carries none either (6.10). Neither can administer a squad.
        expect(resolveAdminAuthority(absentRole, state)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('refuses an absent state however authoritative the role', () => {
    fc.assert(
      fc.property(roleArb, absenceArb, (role, absentState) => {
        // Absence is not read as active: an owner whose state is unknown holds no
        // authority, so a missing state cannot open the Admin_Section.
        expect(resolveAdminAuthority(role, absentState)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('treats null and undefined as the same absence in both positions', () => {
    fc.assert(
      fc.property(roleArb, stateArb, (role, state) => {
        // The two spellings arrive by different routes — `null` from a parsed
        // absent wire value, `undefined` from a caller that identified no
        // membership — and the answer for both must be the same.
        expect(resolveAdminAuthority(null, state)).toBe(
          resolveAdminAuthority(undefined, state),
        );
        expect(resolveAdminAuthority(role, null)).toBe(
          resolveAdminAuthority(role, undefined),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('refuses both absences together', () => {
    for (const absentRole of [null, undefined] as const) {
      for (const absentState of [null, undefined] as const) {
        expect(resolveAdminAuthority(absentRole, absentState)).toBe(false);
      }
    }
  });
});

// Feature: web-squads-screens, Property 25: a caller no membership identifies
// holds no Admin_Authority
// Validates: Requirements 6.10, 10.1
describe('resolveAdminAuthority — the unidentified caller holds no authority', () => {
  it('resolves to false when neither the squads listing nor the squad detail identifies the caller', () => {
    fc.assert(
      fc.property(
        unidentifiedCallerArb,
        ({ squadId, callerMembershipId, summaries, members }) => {
          // 6.10: the collections deliberately mention neither this squad nor this
          // membership, so the resolution finds nothing and must answer `false`
          // rather than falling back on any member's role it can see.
          expect(
            resolveAuthorityForCaller(
              summaries,
              members,
              squadId,
              callerMembershipId,
            ),
          ).toBe(false);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('resolves to false however many other owners and admins the squad holds', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 8 }),
        (squadId, callerMembershipId, otherIds) => {
          const members: SquadMember[] = otherIds
            .filter((membershipId) => membershipId !== callerMembershipId)
            .map((membershipId, index) => ({
              membershipId,
              displayName: `Player ${index}`,
              role: index % 2 === 0 ? ('owner' as const) : ('admin' as const),
              state: 'active' as const,
              isGuest: false,
            }));

          // A squad full of active owners grants the caller nothing: authority is
          // resolved from the caller's *own* membership or not at all.
          expect(
            resolveAuthorityForCaller(
              [],
              members,
              squadId,
              callerMembershipId,
            ),
          ).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('resolves from the caller own membership once one identifies them', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        roleArb,
        stateArb,
        (squadId, callerMembershipId, role, state) => {
          const summaries: SquadSummary[] = [
            {
              squadId,
              name: 'Sunday League',
              role: role ?? null,
              state: state ?? null,
            },
          ];

          // The mirror of the case above: when the listing does identify the
          // caller, the same rule applies to whatever it says — which is what
          // makes the unidentified result an absence rather than a blanket `false`
          // the harness could have produced by accident.
          expect(resolveAuthorityForCaller(summaries, [], squadId, null)).toBe(
            resolveAdminAuthority(role ?? null, state ?? null),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 25: the resolution is a pure, total
// function of the role and the state
// Validates: Requirements 10.1, 20.1, 20.9
describe('resolveAdminAuthority — the resolution is pure and total', () => {
  it('returns a boolean primitive for every combination without throwing', () => {
    fc.assert(
      fc.property(caseArb, ({ role, state }) => {
        const authority = resolveAdminAuthority(role, state);

        expect(typeof authority).toBe('boolean');
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic: repeated calls on one combination agree', () => {
    fc.assert(
      fc.property(caseArb, ({ role, state }) => {
        // The Squad_Screen calls this on every render; two renders holding the
        // same parsed membership must not disagree about the Admin_Section.
        expect(resolveAdminAuthority(role, state)).toBe(
          resolveAdminAuthority(role, state),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('depends on nothing but its two arguments, in order', () => {
    fc.assert(
      fc.property(caseArb, caseArb, (first, second) => {
        const firstAuthority = resolveAdminAuthority(first.role, first.state);

        // Interleaving a call for an unrelated membership changes nothing, so the
        // function holds no state between calls.
        resolveAdminAuthority(second.role, second.state);

        expect(resolveAdminAuthority(first.role, first.state)).toBe(firstAuthority);
      }),
      { numRuns: 300 },
    );
  });
});
