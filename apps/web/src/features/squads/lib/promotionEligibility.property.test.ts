import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import * as promotionEligibilityModule from './promotionEligibility';
import { isPromotable } from './promotionEligibility';
import { ANONYMISED_PLACEHOLDER } from './playerList';
import type { MemberRole, MembershipStateValue } from './enumCodes';
import type { SquadMember } from './parse/squadDetail';

/**
 * Property tests for the one predicate that decides whether a Player_Row offers
 * the Promotion_Control, beside the module they cover as the design's Testing
 * Strategy asks, and running well above the 100-iteration floor (Requirements
 * 20.1, 20.9).
 *
 * The input space is finite and small — an Admin_Authority value against a
 * Membership_State, a Guest_Flag, a Member_Role, a display name that either is or
 * is not the Anonymised_Placeholder, and a caller who is the member, is somebody
 * else, or was never identified. So, like the Admin_Authority properties next
 * door, these tests **enumerate the space exhaustively and generate over it**:
 * the enumeration is what makes Requirement 20.9's "every combination" a fact
 * rather than a sample, and the generated runs are what would catch an
 * argument-order or argument-count change the enumerated table happened to agree
 * with, and what push the name axis across every spelling of the placeholder
 * rather than one representative.
 *
 * Five claims are made:
 *
 * - **The accepted set is exactly the one Requirement 13.1 describes.** Stated
 *   against an independently written oracle — a literal set of accepted
 *   combinations, read off the criterion rather than derived from the six
 *   comparisons the module makes — and cross-checked by counting: of the 192
 *   combinations, exactly two are accepted, and both name an active, non-guest,
 *   plainly-named `member` row belonging to somebody other than the caller.
 * - **Every exclusion of Requirement 13.2 rejects on its own.** Each is asserted
 *   against an otherwise-eligible row, so a test cannot pass because some *other*
 *   conjunct was already saying no. The otherwise-eligible row is asserted
 *   promotable first, which is what stops the exclusion claims being vacuous.
 * - **The Former_Player exclusion recognises exactly the placeholder.** Trimmed
 *   spellings are excluded; case variants, interior-whitespace variants, and
 *   near-miss names are not — the same rule as Requirement 7.9, read through the
 *   predicate the row's presentation uses, so the row's labels and its controls
 *   cannot disagree about who is a former player.
 * - **Self-exclusion is by membership identity, exactly compared.** Including the
 *   unidentified caller (Requirement 6.10), who is refused by the authority
 *   conjunct rather than by matching nobody.
 * - **The predicate is pure and total**, and its module offers nothing else — no
 *   demote, transfer, or remove predicate to render a control from
 *   (Requirement 13.8).
 *
 * What is deliberately **not** claimed here: that a Player_Row renders the control
 * exactly while this returns `true` (Property 26, at the rendering site), that the
 * confirmation and the call follow (Requirements 13.4–13.7), or that the backend
 * permits the promotion — Requirement 10.5 keeps that authoritative server-side.
 * Requirement 13.8's rendering half is pinned by the structural source scan of
 * task 17.5; what this file can say about it is that the feature's only
 * membership-changing predicate is promotion.
 */

// --- the input space ---------------------------------------------------------

/** Whether the caller is the member, is somebody else, or was never identified. */
type IdentityKind = 'own' | 'other' | 'no-viewer';

/** Whether the display name is the Anonymised_Placeholder or an ordinary name. */
type NameKind = 'placeholder' | 'ordinary';

/** The membership whose row is being rendered, throughout. */
const MEMBER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** A different membership: the caller, when the caller is not this member. */
const OTHER_MEMBER_ID = '9c5b94b1-35ad-49bb-b118-8e8fc24abf80';

/** Every Member_Role the Enum_Code_Map names, plus the guest's absent role. */
const ROLE_CASES: readonly (MemberRole | null)[] = [
  'owner',
  'admin',
  'member',
  null,
];

/** Every Membership_State a parsed Squad_Member can carry; never absent (16.8). */
const STATE_CASES: readonly MembershipStateValue[] = ['active', 'inactive'];

const AUTHORITY_CASES: readonly boolean[] = [true, false];

const GUEST_CASES: readonly boolean[] = [true, false];

const NAME_KINDS: readonly NameKind[] = ['placeholder', 'ordinary'];

const IDENTITY_KINDS: readonly IdentityKind[] = ['own', 'other', 'no-viewer'];

/**
 * Spellings that **are** the Anonymised_Placeholder: the backend constant with any
 * leading or trailing whitespace, including a non-breaking space, which a name
 * pasted from elsewhere can easily carry.
 */
const PLACEHOLDER_SPELLINGS: readonly string[] = [
  ANONYMISED_PLACEHOLDER,
  ` ${ANONYMISED_PLACEHOLDER}`,
  `${ANONYMISED_PLACEHOLDER} `,
  `   ${ANONYMISED_PLACEHOLDER}   `,
  `\u00a0${ANONYMISED_PLACEHOLDER}\u00a0`,
  `\n\t${ANONYMISED_PLACEHOLDER}\t\n`,
];

/**
 * Names that are **not** the placeholder, however close they look: case variants,
 * an interior-whitespace variant, near misses, and ordinary names — plus the empty
 * and whitespace-only names, which trim to nothing rather than to the placeholder.
 *
 * The case variants matter most. Reading them as the placeholder would strip a
 * real player's Promotion_Control and label them as erased, which is the wrong
 * direction to guess in (Requirement 7.9).
 */
const ORDINARY_NAMES: readonly string[] = [
  'Dave',
  'BigDave',
  'former player',
  'FORMER PLAYER',
  'FoRmEr PlAyEr',
  'Former  player',
  'Former players',
  'Former player!',
  'Formerplayer',
  'Former',
  'player',
  'Former player and friends',
  '',
  '   ',
  'Zoë',
  '日本語',
  '🙈',
];

interface EligibilityCase {
  readonly authority: boolean;
  readonly state: MembershipStateValue;
  readonly isGuest: boolean;
  readonly role: MemberRole | null;
  readonly nameKind: NameKind;
  readonly identityKind: IdentityKind;
}

/** The full cross product: 2 × 2 × 2 × 4 × 2 × 3 = 192 combinations. */
const ALL_CASES: readonly EligibilityCase[] = AUTHORITY_CASES.flatMap((authority) =>
  STATE_CASES.flatMap((state) =>
    GUEST_CASES.flatMap((isGuest) =>
      ROLE_CASES.flatMap((role) =>
        NAME_KINDS.flatMap((nameKind) =>
          IDENTITY_KINDS.map((identityKind) => ({
            authority,
            state,
            isGuest,
            role,
            nameKind,
            identityKind,
          })),
        ),
      ),
    ),
  ),
);

/** A readable name for a combination, used in failure output. */
function describeCase(eligibilityCase: EligibilityCase): string {
  return [
    `authority=${String(eligibilityCase.authority)}`,
    `state=${eligibilityCase.state}`,
    `guest=${String(eligibilityCase.isGuest)}`,
    `role=${String(eligibilityCase.role)}`,
    `name=${eligibilityCase.nameKind}`,
    `caller=${eligibilityCase.identityKind}`,
  ].join(' ');
}

// --- the oracle --------------------------------------------------------------

/**
 * The accepted set written straight out of Requirement 13.1 — "the caller holds
 * Admin_Authority" and a Player_Row "whose Membership_State is active, whose
 * Guest_Flag is not set, whose Member_Role is member, and whose
 * Player_Display_Name is not the Anonymised_Placeholder", minus the caller's own
 * membership (13.2) — as literal combinations rather than as a chain of
 * comparisons. A restatement of the module's six early returns would agree with an
 * inverted comparison; a literal enumeration cannot.
 *
 * Two entries rather than one because "not the caller's own membership" is true
 * both when another membership identified the caller and when none did.
 */
const ACCEPTED_COMBINATIONS: ReadonlySet<string> = new Set([
  'authority=true|active|not-guest|member|ordinary|other',
  'authority=true|active|not-guest|member|ordinary|no-viewer',
]);

/** The oracle's key for a combination: the same six facts, in a fixed order. */
function oracleKey(eligibilityCase: EligibilityCase): string {
  return [
    `authority=${String(eligibilityCase.authority)}`,
    eligibilityCase.state,
    eligibilityCase.isGuest ? 'guest' : 'not-guest',
    String(eligibilityCase.role),
    eligibilityCase.nameKind,
    eligibilityCase.identityKind,
  ].join('|');
}

/** Whether Requirement 13.1 offers the Promotion_Control for this combination. */
function oracleEligibility(eligibilityCase: EligibilityCase): boolean {
  return ACCEPTED_COMBINATIONS.has(oracleKey(eligibilityCase));
}

// --- driving the predicate ---------------------------------------------------

/** The caller's own membership identity for an identity kind. */
function viewerMembershipIdFor(identityKind: IdentityKind): string | null {
  switch (identityKind) {
    case 'own':
      return MEMBER_ID;
    case 'other':
      return OTHER_MEMBER_ID;
    // 6.10: no membership identified the caller at all.
    case 'no-viewer':
      return null;
  }
}

/** The Squad_Member a combination describes, carrying the supplied name. */
function memberFor(eligibilityCase: EligibilityCase, displayName: string): SquadMember {
  return {
    membershipId: MEMBER_ID,
    displayName,
    role: eligibilityCase.role,
    state: eligibilityCase.state,
    isGuest: eligibilityCase.isGuest,
  };
}

/** The predicate applied to a combination and one spelling of its name kind. */
function eligibilityOf(
  eligibilityCase: EligibilityCase,
  displayName: string,
): boolean {
  return isPromotable(
    memberFor(eligibilityCase, displayName),
    viewerMembershipIdFor(eligibilityCase.identityKind),
    eligibilityCase.authority,
  );
}

/** One deterministic representative name per kind, for the enumerated runs. */
function representativeNameFor(nameKind: NameKind): string {
  return nameKind === 'placeholder' ? ANONYMISED_PLACEHOLDER : 'Dave';
}

/**
 * The combination Requirement 13.1 accepts. Every exclusion property below starts
 * from this row and changes exactly one fact, so a rejection can only be the fact
 * that changed.
 */
const ELIGIBLE_CASE: EligibilityCase = {
  authority: true,
  state: 'active',
  isGuest: false,
  role: 'member',
  nameKind: 'ordinary',
  identityKind: 'other',
};

// --- generators --------------------------------------------------------------

const authorityArb: fc.Arbitrary<boolean> = fc.boolean();

const stateArb: fc.Arbitrary<MembershipStateValue> = fc.constantFrom(...STATE_CASES);

const roleArb: fc.Arbitrary<MemberRole | null> = fc.constantFrom(...ROLE_CASES);

const identityKindArb: fc.Arbitrary<IdentityKind> = fc.constantFrom(...IDENTITY_KINDS);

const nameKindArb: fc.Arbitrary<NameKind> = fc.constantFrom(...NAME_KINDS);

const placeholderSpellingArb: fc.Arbitrary<string> = fc.constantFrom(
  ...PLACEHOLDER_SPELLINGS,
);

const ordinaryNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...ORDINARY_NAMES) },
  // Arbitrary text as well, so the ordinary side of the name axis is not just the
  // near misses somebody thought of: a name is rendered exactly as parsed, and the
  // predicate reads nothing about it beyond the placeholder comparison.
  {
    weight: 1,
    arbitrary: fc
      .string({ minLength: 0, maxLength: 24 })
      .filter((name) => name.trim() !== ANONYMISED_PLACEHOLDER),
  },
);

/** A name of a given kind. */
function nameArbFor(nameKind: NameKind): fc.Arbitrary<string> {
  return nameKind === 'placeholder' ? placeholderSpellingArb : ordinaryNameArb;
}

const caseArb: fc.Arbitrary<EligibilityCase> = fc.record({
  authority: authorityArb,
  state: stateArb,
  isGuest: fc.boolean(),
  role: roleArb,
  nameKind: nameKindArb,
  identityKind: identityKindArb,
});

/** A combination paired with one concrete spelling of its name kind. */
const caseWithNameArb: fc.Arbitrary<{
  eligibilityCase: EligibilityCase;
  displayName: string;
}> = caseArb.chain((eligibilityCase) =>
  fc.record({
    eligibilityCase: fc.constant(eligibilityCase),
    displayName: nameArbFor(eligibilityCase.nameKind),
  }),
);

/** A role that is not `member`, so the positive role test must reject it. */
const nonMemberRoleArb: fc.Arbitrary<MemberRole | null> = fc.constantFrom(
  'owner' as const,
  'admin' as const,
  null,
);

// Feature: web-squads-screens, Property 27: Promotion eligibility is exact and
// never offers the deferred actions
// Validates: Requirements 13.1, 13.2, 13.3, 20.9
describe('isPromotable — the accepted set is exactly the active, non-guest, plainly-named member', () => {
  it('agrees with the accepted set of Requirement 13.1 on every generated combination', () => {
    fc.assert(
      fc.property(caseWithNameArb, ({ eligibilityCase, displayName }) => {
        // The oracle is a literal set of accepted combinations, so this is the
        // criterion checked rather than the implementation restated.
        expect(eligibilityOf(eligibilityCase, displayName)).toBe(
          oracleEligibility(eligibilityCase),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('accepts exactly two of the 192 combinations, and names which two', () => {
    const accepted = ALL_CASES.filter((eligibilityCase) =>
      eligibilityOf(eligibilityCase, representativeNameFor(eligibilityCase.nameKind)),
    );

    // Exhaustive, so "exactly" is a fact about the whole space and not a sample:
    // 192 combinations in, two out — the same row seen by an identified caller and
    // by a caller no membership identified.
    expect(ALL_CASES).toHaveLength(192);
    expect(accepted.map(describeCase)).toEqual([
      'authority=true state=active guest=false role=member name=ordinary caller=other',
      'authority=true state=active guest=false role=member name=ordinary caller=no-viewer',
    ]);
  });

  it('returns the oracle answer for every combination in the space, enumerated', () => {
    for (const eligibilityCase of ALL_CASES) {
      const displayName = representativeNameFor(eligibilityCase.nameKind);

      expect({
        combination: describeCase(eligibilityCase),
        promotable: eligibilityOf(eligibilityCase, displayName),
      }).toEqual({
        combination: describeCase(eligibilityCase),
        promotable: oracleEligibility(eligibilityCase),
      });
    }
  });

  it('offers the control on the eligible row, so the exclusions below are not vacuous', () => {
    fc.assert(
      fc.property(ordinaryNameArb, (displayName) => {
        // 13.1 read positively: an active, non-guest `member` row that is not the
        // caller's own and carries an ordinary name is promotable, whatever that
        // name happens to be.
        expect(eligibilityOf(ELIGIBLE_CASE, displayName)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 27: Promotion eligibility is exact and
// never offers the deferred actions
// Validates: Requirements 13.1, 13.2, 20.9
describe('isPromotable — every exclusion of Requirement 13.2 rejects on its own', () => {
  it('offers no control on any row while the caller holds no Admin_Authority', () => {
    fc.assert(
      fc.property(caseWithNameArb, ({ eligibilityCase, displayName }) => {
        // 13.2: authority is the outer condition — withdraw it and the answer is
        // `false` for every row in the space, including the otherwise-eligible one.
        expect(
          eligibilityOf({ ...eligibilityCase, authority: false }, displayName),
        ).toBe(false);
      }),
      { numRuns: 600 },
    );
  });

  it('refuses an inactive membership however eligible it otherwise is', () => {
    fc.assert(
      fc.property(ordinaryNameArb, (displayName) => {
        // An inactive membership keeps its role for history and replay, so an
        // inactive `member` still parses as a member. The state test is what stops
        // a removed player being promoted.
        expect(
          eligibilityOf({ ...ELIGIBLE_CASE, state: 'inactive' }, displayName),
        ).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('refuses a guest membership however eligible it otherwise is', () => {
    fc.assert(
      fc.property(ordinaryNameArb, (displayName) => {
        // 13.2: a guest has no account to administer with. Asserted with the role
        // still `member`, so the rejection is the Guest_Flag and not the absent
        // role a real guest also carries.
        expect(eligibilityOf({ ...ELIGIBLE_CASE, isGuest: true }, displayName)).toBe(
          false,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('refuses an owner, an admin, and an absent role', () => {
    fc.assert(
      fc.property(nonMemberRoleArb, ordinaryNameArb, (role, displayName) => {
        // 13.2 for owner and admin; 16.8 for the absent role a guest carries. The
        // module's positive `role === 'member'` test covers all three at once.
        expect(eligibilityOf({ ...ELIGIBLE_CASE, role }, displayName)).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it('refuses a Former_Player row', () => {
    fc.assert(
      fc.property(placeholderSpellingArb, (displayName) => {
        // 7.8 and 13.1: an erased membership offers no Promotion_Control, in every
        // spelling of the placeholder the trim accepts.
        expect(
          eligibilityOf({ ...ELIGIBLE_CASE, nameKind: 'placeholder' }, displayName),
        ).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("refuses the caller's own membership", () => {
    fc.assert(
      fc.property(ordinaryNameArb, (displayName) => {
        // 13.2: nobody is offered promotion of their own membership.
        expect(
          eligibilityOf({ ...ELIGIBLE_CASE, identityKind: 'own' }, displayName),
        ).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('refuses a state and a role this feature does not name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).filter((value) => value !== 'active'),
        fc.string({ minLength: 1, maxLength: 12 }).filter((value) => value !== 'member'),
        ordinaryNameArb,
        (unnamedState, unnamedRole, displayName) => {
          const base = memberFor(ELIGIBLE_CASE, displayName);

          // Both tests in the module are positive — `state === 'active'` and
          // `role === 'member'` — so a value a future backend adds and this feature
          // does not yet understand is refused rather than admitted. That is the
          // safe direction for an admin affordance.
          expect(
            isPromotable(
              { ...base, state: unnamedState as MembershipStateValue },
              OTHER_MEMBER_ID,
              true,
            ),
          ).toBe(false);
          expect(
            isPromotable(
              { ...base, role: unnamedRole as MemberRole },
              OTHER_MEMBER_ID,
              true,
            ),
          ).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 27: the Former_Player exclusion accepts
// exactly the Anonymised_Placeholder
// Validates: Requirements 13.1, 13.2
describe('isPromotable — the placeholder exclusion is exact after trimming', () => {
  it('excludes every trimmed spelling of the placeholder', () => {
    fc.assert(
      fc.property(placeholderSpellingArb, (displayName) => {
        expect(eligibilityOf(ELIGIBLE_CASE, displayName)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('excludes no case variant, interior-whitespace variant, or near-miss name', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ORDINARY_NAMES),
        (displayName) => {
          // `former player`, `FORMER PLAYER`, and `Former  player` are ordinary
          // names: a squad member who types their name that way keeps their
          // Promotion_Control (Requirement 7.9).
          expect(eligibilityOf(ELIGIBLE_CASE, displayName)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('reads the name and nothing else about it: two rows differing only in name', () => {
    fc.assert(
      fc.property(placeholderSpellingArb, ordinaryNameArb, (erased, ordinary) => {
        // The same membership, the same state, role, and Guest_Flag; only the name
        // differs. So the exclusion is a fact about the name, not a side effect of
        // any other field.
        expect(eligibilityOf(ELIGIBLE_CASE, erased)).toBe(false);
        expect(eligibilityOf(ELIGIBLE_CASE, ordinary)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 27: self-exclusion is by membership
// identity, exactly compared
// Validates: Requirements 6.10, 13.2, 13.3
describe('isPromotable — the caller is recognised by membership identity', () => {
  it('refuses exactly the row whose membership identity is the caller own', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), ordinaryNameArb, (memberId, viewerId, displayName) => {
        const member: SquadMember = {
          membershipId: memberId,
          displayName,
          role: 'member',
          state: 'active',
          isGuest: false,
        };

        // One predicate, two callers: the member themselves and anybody else.
        expect(isPromotable(member, memberId, true)).toBe(false);
        expect(isPromotable(member, viewerId, true)).toBe(
          viewerId !== memberId,
        );
      }),
      { numRuns: 400 },
    );
  });

  it('compares identities exactly, neither trimmed nor case-folded', () => {
    fc.assert(
      fc.property(fc.uuid(), ordinaryNameArb, (memberId, displayName) => {
        const member: SquadMember = {
          membershipId: memberId,
          displayName,
          role: 'member',
          state: 'active',
          isGuest: false,
        };
        const upperCased = memberId.toUpperCase();
        const padded = ` ${memberId} `;

        // A membership identity is opaque to this feature, so it is compared as a
        // value. A differently-spelled identity is a different membership, which is
        // the conservative reading: at worst the caller is offered a control the
        // backend will refuse (Requirement 10.5).
        expect(isPromotable(member, upperCased, true)).toBe(
          upperCased !== memberId,
        );
        expect(isPromotable(member, padded, true)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('refuses every row when no membership identified the caller, because authority is absent', () => {
    fc.assert(
      fc.property(caseWithNameArb, ({ eligibilityCase, displayName }) => {
        // 6.10: an unidentified caller reaches the screen holding no
        // Admin_Authority, so a `null` viewer identity is answered by the authority
        // conjunct and never read as "matches nobody, so promote away".
        expect(
          eligibilityOf(
            { ...eligibilityCase, authority: false, identityKind: 'no-viewer' },
            displayName,
          ),
        ).toBe(false);
      }),
      { numRuns: 400 },
    );
  });
});

// Feature: web-squads-screens, Property 27: the eligibility predicate is pure and
// total
// Validates: Requirements 13.3, 20.1, 20.9
describe('isPromotable — the predicate is pure and total', () => {
  it('returns a boolean primitive for every combination without throwing', () => {
    fc.assert(
      fc.property(caseWithNameArb, ({ eligibilityCase, displayName }) => {
        expect(typeof eligibilityOf(eligibilityCase, displayName)).toBe('boolean');
      }),
      { numRuns: 600 },
    );
  });

  it('is deterministic: repeated calls on one row agree', () => {
    fc.assert(
      fc.property(caseWithNameArb, ({ eligibilityCase, displayName }) => {
        // The Player_List calls this once per row on every render; two renders
        // holding the same parsed membership must not disagree about the control.
        expect(eligibilityOf(eligibilityCase, displayName)).toBe(
          eligibilityOf(eligibilityCase, displayName),
        );
      }),
      { numRuns: 400 },
    );
  });

  it('depends on nothing but its three arguments, in order', () => {
    fc.assert(
      fc.property(caseWithNameArb, caseWithNameArb, (first, second) => {
        const firstAnswer = eligibilityOf(first.eligibilityCase, first.displayName);

        // Interleaving a call for an unrelated row changes nothing, so the
        // predicate holds no state between calls.
        eligibilityOf(second.eligibilityCase, second.displayName);

        expect(eligibilityOf(first.eligibilityCase, first.displayName)).toBe(
          firstAnswer,
        );
      }),
      { numRuns: 400 },
    );
  });

  it('neither mutates nor requires a mutable Squad_Member', () => {
    fc.assert(
      fc.property(caseWithNameArb, ({ eligibilityCase, displayName }) => {
        const member = Object.freeze(memberFor(eligibilityCase, displayName));
        const before = { ...member };

        const promotable = isPromotable(
          member,
          viewerMembershipIdFor(eligibilityCase.identityKind),
          eligibilityCase.authority,
        );

        // The state a screen holds is the parsed membership; deciding what to draw
        // from it must not write to it.
        expect(promotable).toBe(oracleEligibility(eligibilityCase));
        expect({ ...member }).toEqual(before);
      }),
      { numRuns: 400 },
    );
  });

  it('disregards any further property a row carries', () => {
    fc.assert(
      fc.property(caseWithNameArb, fc.anything(), ({ eligibilityCase, displayName }, extra) => {
        const member = memberFor(eligibilityCase, displayName);
        const decorated = { ...member, isFormerPlayer: true, ratingEntry: extra };

        // A `PlayerListRow` is structurally a Squad_Member plus derived fields, so
        // a row is handed straight to this predicate. Only the five member fields
        // may contribute — the row's own `isFormerPlayer` must not be read as an
        // eligibility input, and a rating must not be one at all.
        expect(
          isPromotable(
            decorated as SquadMember,
            viewerMembershipIdFor(eligibilityCase.identityKind),
            eligibilityCase.authority,
          ),
        ).toBe(oracleEligibility(eligibilityCase));
      }),
      { numRuns: 400 },
    );
  });
});

// Feature: web-squads-screens, Property 27: Promotion eligibility is exact and
// never offers the deferred actions
// Validates: Requirements 13.8
describe('promotionEligibility — promotion is the only membership-changing predicate', () => {
  it('exports exactly the promotion predicate, and nothing that demotes, transfers, or removes', () => {
    const exported = Object.keys(promotionEligibilityModule).sort();

    // 13.8: demotion, ownership transfer, and removal are out of scope. A control
    // for one of them would need an eligibility rule, and this is the module such a
    // rule would live in — so its surface is pinned to promotion alone. The
    // rendering half of the criterion is held by the structural source scan.
    expect(exported).toEqual(['isPromotable']);

    for (const name of exported) {
      expect(name).not.toMatch(/demote|transfer|remove|delete|leave|kick/i);
    }
  });

  it('takes exactly the three arguments Requirement 13.3 names', () => {
    // A pure predicate over one Squad_Member plus the caller's own membership
    // identity and Admin_Authority — no squad, no roster, no client, nothing that
    // would make the eligibility untestable without a browser.
    expect(isPromotable).toHaveLength(3);
  });
});
