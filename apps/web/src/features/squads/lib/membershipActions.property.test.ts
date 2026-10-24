import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  isDemotable,
  isOwnershipTarget,
  isRemovable,
  leaveEligibility,
  resolveOwnerAuthority,
} from './membershipActions';
import { ANONYMISED_PLACEHOLDER } from './playerList';
import type { SquadMember } from './parse/squadDetail';
import type { MembershipState, SquadRole } from './wireEnums';

/**
 * Property tests for the membership-action predicates: leave, remove, transfer
 * ownership and demote.
 *
 * The input space is small — a target's role, state, guest flag and name kind,
 * against a caller who is the target, somebody else, or unidentified, holding
 * each authority — so every claim is generated over the whole space, and each
 * accepted set is stated against an oracle written from the product rules
 * rather than from the module's comparisons:
 *
 * - leave: an active caller with a role may leave unless they are the owner,
 *   who is told to transfer first;
 * - remove: authority, and an active target who is not the owner nor the caller;
 * - transfer: the owner, and an active registered target other than the caller
 *   (and not a Former_Player);
 * - demote: authority, and an active admin target other than the caller.
 *
 * Universal claims beside the oracles: the owner is never offered leave,
 * removal or demotion; nobody is offered an action on their own membership; no
 * action is offered without the authority it needs; and every predicate is
 * pure.
 */

const MEMBER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const OTHER_ID = '9c5b94b1-35ad-49bb-b118-8e8fc24abf80';

const ROLES: readonly (SquadRole | null)[] = ['Owner', 'Admin', 'Member', null];
const STATES: readonly MembershipState[] = ['Active', 'Inactive'];

type IdentityKind = 'own' | 'other' | 'no-viewer';

const roleArb = fc.constantFrom(...ROLES);
const stateArb = fc.constantFrom(...STATES);
const identityArb = fc.constantFrom<IdentityKind>('own', 'other', 'no-viewer');
const nameArb = fc.oneof(
  fc.constantFrom(ANONYMISED_PLACEHOLDER, ` ${ANONYMISED_PLACEHOLDER} `),
  fc.string({ minLength: 1, maxLength: 20 }),
);

const memberArb: fc.Arbitrary<SquadMember> = fc.record({
  membershipId: fc.constant(MEMBER_ID),
  displayName: nameArb,
  role: roleArb,
  state: stateArb,
  isGuest: fc.boolean(),
  appearances: fc.nat({ max: 50 }),
  ratingState: fc.constant(null),
});

function viewerIdOf(identity: IdentityKind): string | null {
  if (identity === 'own') {
    return MEMBER_ID;
  }
  return identity === 'other' ? OTHER_ID : null;
}

const isPlaceholder = (name: string): boolean =>
  name.trim() === ANONYMISED_PLACEHOLDER;

describe('leaveEligibility', () => {
  it('lets an active caller with a role leave, except the owner, who must transfer first', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLES, undefined), fc.constantFrom(...STATES, null), (role, state) => {
        const expected =
          state !== 'Active' || role === null || role === undefined
            ? 'none'
            : role === 'Owner'
              ? 'owner-must-transfer'
              : 'can-leave';
        expect(leaveEligibility(role, state)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('never offers the owner a way to leave', () => {
    for (const state of [...STATES, null]) {
      expect(leaveEligibility('Owner', state)).not.toBe('can-leave');
    }
    expect(leaveEligibility('Owner', 'Active')).toBe('owner-must-transfer');
  });
});

describe('resolveOwnerAuthority', () => {
  it('holds exactly for an active owner', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLES, undefined), fc.constantFrom(...STATES, null), (role, state) => {
        expect(resolveOwnerAuthority(role, state)).toBe(
          role === 'Owner' && state === 'Active',
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe('isRemovable', () => {
  it('accepts exactly an active, non-owner target other than the caller, for a caller with authority', () => {
    fc.assert(
      fc.property(memberArb, identityArb, fc.boolean(), (member, identity, authority) => {
        const expected =
          authority &&
          member.state === 'Active' &&
          member.role !== 'Owner' &&
          identity !== 'own';
        expect(isRemovable(member, viewerIdOf(identity), authority)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('includes guests', () => {
    const guest: SquadMember = {
      membershipId: MEMBER_ID,
      displayName: 'Guest Gary',
      role: null,
      state: 'Active',
      isGuest: true,
      appearances: 0,
      ratingState: null,
    };
    expect(isRemovable(guest, null, true)).toBe(true);
  });
});

describe('isOwnershipTarget', () => {
  it('accepts exactly an active, registered, non-owner, non-anonymised target other than the owner caller', () => {
    fc.assert(
      fc.property(memberArb, identityArb, fc.boolean(), (member, identity, owner) => {
        const expected =
          owner &&
          member.state === 'Active' &&
          !member.isGuest &&
          member.role !== 'Owner' &&
          !isPlaceholder(member.displayName) &&
          identity !== 'own';
        expect(isOwnershipTarget(member, viewerIdOf(identity), owner)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });
});

describe('isDemotable', () => {
  it('accepts exactly an active registered admin other than the caller, for a caller with authority', () => {
    fc.assert(
      fc.property(memberArb, identityArb, fc.boolean(), (member, identity, authority) => {
        const expected =
          authority &&
          member.state === 'Active' &&
          !member.isGuest &&
          member.role === 'Admin' &&
          identity !== 'own';
        expect(isDemotable(member, viewerIdOf(identity), authority)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });
});

describe('universal claims over every row action', () => {
  const rowPredicates = [
    ['remove', isRemovable],
    ['transfer', isOwnershipTarget],
    ['demote', isDemotable],
  ] as const;

  it('never offers an action on the caller’s own membership', () => {
    fc.assert(
      fc.property(memberArb, fc.boolean(), (member, authority) => {
        for (const [, predicate] of rowPredicates) {
          expect(predicate(member, MEMBER_ID, authority)).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('never offers an action without the authority it needs', () => {
    fc.assert(
      fc.property(memberArb, identityArb, (member, identity) => {
        for (const [, predicate] of rowPredicates) {
          expect(predicate(member, viewerIdOf(identity), false)).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('never offers removal, demotion or transfer with the owner as target', () => {
    fc.assert(
      fc.property(memberArb, identityArb, fc.boolean(), (member, identity, authority) => {
        const owner = { ...member, role: 'Owner' as const };
        for (const [, predicate] of rowPredicates) {
          expect(predicate(owner, viewerIdOf(identity), authority)).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('is pure: the same arguments always give the same answer', () => {
    fc.assert(
      fc.property(memberArb, identityArb, fc.boolean(), (member, identity, authority) => {
        for (const [name, predicate] of rowPredicates) {
          const first = predicate(member, viewerIdOf(identity), authority);
          const second = predicate({ ...member }, viewerIdOf(identity), authority);
          expect(second, name).toBe(first);
        }
      }),
      { numRuns: 500 },
    );
  });
});
