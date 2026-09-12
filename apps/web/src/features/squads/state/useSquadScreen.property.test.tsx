/**
 * Property test for the two Squad_Screen calls degrading independently (task 7.8).
 *
 * **Property 18: The two calls degrade independently and `GetSquad` governs
 * membership.** Two directions, asserted separately because they are separate
 * claims about the same pair of slots:
 *
 * 1. **A leaderboard that does not arrive never fails the screen**
 *    (Requirement 7.10). Over a leaderboard `transport-failure`, `timeout`, and
 *    `parse-failure` against a **successful** `GetSquad`: every Squad_Member still
 *    has its Player_Row, the detail slot settles `loaded`, and the leaderboard
 *    slot settles `unavailable`. No Generic_Squads_Failure, no
 *    Not_Found_Treatment — the rows simply carry `leaderboardObtained: false`,
 *    which is what the Rating_Unavailable presentation reads.
 * 2. **`GetSquad` governs membership** (Requirement 7.11). Over a **successful**
 *    leaderboard against a failing and a not-found `GetSquad`: no Player_Row is
 *    produced at all, and the leaderboard value is *dropped rather than held*, so
 *    no player identity can be rendered from leaderboard entries alone. The
 *    generated entries are deliberately derived from a membership collection that
 *    *would* have produced rows had the detail landed, and their display names are
 *    then asserted absent from the row set.
 *
 * The two calls are issued concurrently, so which one settles first is generated
 * rather than assumed: each fake settles after a generated number of microtask
 * ticks, which exercises both interleavings of every arm. That matters for
 * direction 2 in particular — a leaderboard accepted *before* the detail settles
 * is kept by the reducer and then dropped by the detail's failure, while one
 * accepted *after* lands in a slot the failure already cleared. Neither may reach
 * the screen.
 *
 * Every seam is injected, so no router, no `AuthProvider`, and no transport is
 * involved: the fake Squads_Api answers with `CallResult` values directly. The
 * 10-second Squad_Call_Timeout belongs to `api/squadsApi.ts` and is tested beside
 * it, so a timeout is modelled as the `CallResult` arm rather than by advancing a
 * clock.
 *
 * Deliberately **not** claimed here: that a malformed `squadId` issues no call
 * (Requirement 6.6, a different property), the composition and ordering rules
 * themselves (Properties beside `lib/playerList.ts`), and the choice between a
 * Display_Rating, a Provisional_Band, and a Rating_Unavailable label
 * (`lib/ratingPresentation.ts`).
 *
 * Feature: web-squads-screens, Property 18: The two calls degrade independently and GetSquad governs membership
 * Validates: Requirements 7.10, 7.11
 */

import { describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import fc from 'fast-check';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import type { MemberRole, MembershipStateValue } from '../lib/enumCodes';
import type { FeatureFlag } from '../lib/parse/featureFlags';
import type {
  DisplayRatingEntry,
  DisplayRatingLeaderboard,
} from '../lib/parse/leaderboard';
import type { SquadDetail, SquadMember } from '../lib/parse/squadDetail';
import { useSquadScreen, type SquadScreenMachine } from './useSquadScreen';

// --- generators --------------------------------------------------------------

/** A well-formed 36-character hyphenated identity, in either letter case. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((identity) => identity.toUpperCase()) },
);

/** A Member_Role, including the `null` a guest membership carries (16.8). */
const roleArb: fc.Arbitrary<MemberRole | null> = fc.constantFrom(
  'owner' as const,
  'admin' as const,
  'member' as const,
  null,
);

/** A Membership_State; never absent, since a membership always has one. */
const stateArb: fc.Arbitrary<MembershipStateValue> = fc.constantFrom(
  'active' as const,
  'inactive' as const,
);

/** A Player_Display_Name, including the Anonymised_Placeholder. */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'Dave',
      'dave',
      'Big Dave',
      'Sam',
      'Former player',
      '🙈 keeper',
    ),
  },
  { weight: 2, arbitrary: fc.string({ minLength: 0, maxLength: 20 }) },
);

/** The one Feature_Flag the Enum_Code_Map names, switched either way. */
const featuresArb: fc.Arbitrary<readonly FeatureFlag[]> = fc.oneof(
  fc.constant([] as readonly FeatureFlag[]),
  fc
    .boolean()
    .map(
      (isEnabled) =>
        [
          { feature: 'live-match-tracking', isEnabled },
        ] as readonly FeatureFlag[],
    ),
);

/** A Squad_Member's fields other than its identity. */
const memberBodyArb = fc.record({
  displayName: nameArb,
  role: roleArb,
  state: stateArb,
  isGuest: fc.boolean(),
});

/**
 * A membership collection with **distinct** identities — the form `GetSquad`
 * returns, and the form `parseDisplayRatingLeaderboard` requires of the entries
 * derived from it (Requirement 8.11 rejects a repeated identity).
 */
const membersArb: fc.Arbitrary<readonly SquadMember[]> = fc
  .array(memberBodyArb, { minLength: 1, maxLength: 8 })
  .chain((bodies) =>
    fc
      .uniqueArray(identityArb, {
        minLength: bodies.length,
        maxLength: bodies.length,
      })
      .map((identities) =>
        bodies.map((body, index) => ({
          ...body,
          membershipId: identities[index],
        })),
      ),
  );

/** A parsed Squad_Detail for a generated squad identity. */
const detailArb = (squadId: string): fc.Arbitrary<SquadDetail> =>
  fc.record({
    squadId: fc.constant(squadId),
    name: fc.string({ minLength: 1, maxLength: 24 }),
    members: membersArb,
    features: featuresArb,
  });

/** A finite Display_Rating value, as the parser reads one. */
const ratingValueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: -2000, max: 3000 }) },
  { weight: 1, arbitrary: fc.double({ min: -5000, max: 5000, noNaN: true }) },
);

/**
 * A leaderboard whose entries name **exactly** the memberships supplied — the
 * entries that *would* have decorated a Player_Row for each of them, had the
 * `GetSquad` call landed. Values are generated independently of the members.
 */
const leaderboardForArb = (
  members: readonly SquadMember[],
): fc.Arbitrary<DisplayRatingLeaderboard> =>
  fc
    .array(ratingValueArb, { minLength: members.length, maxLength: members.length })
    .map((values) => ({
      entries: members.map(
        (member, index): DisplayRatingEntry => ({
          membershipId: member.membershipId,
          displayName: member.displayName,
          value: values[index],
        }),
      ),
    }));

/**
 * The non-success arms a leaderboard call can settle on that Requirement 7.10
 * names by consequence: none of them may fail the screen.
 */
const leaderboardFailureArb: fc.Arbitrary<
  CallResult<DisplayRatingLeaderboard>
> = fc.constantFrom(
  { kind: 'transport-failure' } as const,
  { kind: 'timeout' } as const,
  { kind: 'parse-failure' } as const,
);

/**
 * A `GetSquad` outcome that yields no Squad_Detail: the four failing arms and
 * not-found, which are separate phases and never both (Requirement 6.7).
 */
const detailAbsenceArb: fc.Arbitrary<CallResult<SquadDetail>> = fc.constantFrom(
  { kind: 'transport-failure' } as const,
  { kind: 'timeout' } as const,
  { kind: 'parse-failure' } as const,
  { kind: 'auth-failure' } as const,
  { kind: 'not-found' } as const,
);

/** How many microtask ticks a fake call waits before settling. */
const settleDelayArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 3 });

// --- the fake Squads_Api -----------------------------------------------------

/**
 * A method this property never reaches. Typed to return `never`, so calling one
 * fails the run loudly rather than settling something the property would then
 * quietly assert over.
 */
const unreached =
  (method: string) =>
  (): never => {
    throw new Error(`the ${method} call is not part of Property 18`);
  };

/** Settle with `result` after `ticks` microtasks, so the two calls interleave. */
async function settleAfter<T>(ticks: number, result: T): Promise<T> {
  for (let tick = 0; tick < ticks; tick += 1) {
    await Promise.resolve();
  }

  return result;
}

/** What the two generated calls answer, and after how long. */
interface FakeCalls {
  readonly detail: CallResult<SquadDetail>;
  readonly detailDelay: number;
  readonly leaderboard: CallResult<DisplayRatingLeaderboard>;
  readonly leaderboardDelay: number;
}

/**
 * A Squads_Api answering the two squad reads from generated `CallResult` values
 * and nothing else — no transport, no `fetch`, no generated client, no timers.
 */
function fakeSquadsApi(calls: FakeCalls): SquadsApi {
  return {
    getSquad: () => settleAfter(calls.detailDelay, calls.detail),
    getDisplayRatingLeaderboard: () =>
      settleAfter(calls.leaderboardDelay, calls.leaderboard),
    listMySquads: unreached('ListMySquads'),
    createSquad: unreached('CreateSquad'),
    redeemInvite: unreached('RedeemInvite'),
    previewInvite: unreached('PreviewInvite'),
    listInvites: unreached('ListInvites'),
    generateInvite: unreached('GenerateInvite'),
    revokeInvite: unreached('RevokeInvite'),
    createGuest: unreached('CreateGuest'),
    editGuest: unreached('EditGuest'),
    promoteToAdmin: unreached('PromoteToAdmin'),
    getFeatureFlags: unreached('GetFeatureFlags'),
    setFeatureFlag: unreached('SetFeatureFlag'),
  };
}

/** Let every settled call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 24; round += 1) {
      await Promise.resolve();
    }
  });
}

/** Mount the machine over the fake pair and let both calls settle. */
async function settleMachine(
  squadId: string,
  calls: FakeCalls,
): Promise<SquadScreenMachine> {
  const { result } = renderHook(() =>
    useSquadScreen({ api: fakeSquadsApi(calls), squadId }),
  );

  await flush();

  return result.current;
}

/** The membership identities of a collection, sorted, for a multiset comparison. */
function identityMultisetOf(
  rows: readonly { readonly membershipId: string }[],
): string[] {
  return rows.map((row) => row.membershipId).sort();
}

// --- Properties --------------------------------------------------------------

describe('useSquadScreen — Property 18 (the two calls degrade independently)', () => {
  // Feature: web-squads-screens, Property 18: The two calls degrade independently and GetSquad governs membership
  // Validates: Requirements 7.10
  it('renders every member row and settles the leaderboard unavailable, for any leaderboard failure against a successful GetSquad', async () => {
    await fc.assert(
      fc.asyncProperty(
        identityArb.chain((squadId) =>
          fc.record({
            squadId: fc.constant(squadId),
            detail: detailArb(squadId),
            leaderboard: leaderboardFailureArb,
            detailDelay: settleDelayArb,
            leaderboardDelay: settleDelayArb,
          }),
        ),
        async (scenario) => {
          try {
            const machine = await settleMachine(scenario.squadId, {
              detail: { kind: 'success', value: scenario.detail },
              detailDelay: scenario.detailDelay,
              leaderboard: scenario.leaderboard,
              leaderboardDelay: scenario.leaderboardDelay,
            });

            // 7.10: the leaderboard's absence is not the screen's failure. No
            // Generic_Squads_Failure and no Not_Found_Treatment.
            expect(machine.detailPhase).toBe('loaded');
            expect(machine.detail).toEqual(scenario.detail);
            expect(machine.failed).toBe(false);
            expect(machine.notFound).toBe(false);
            expect(machine.busy).toBe(false);

            // 7.10: every non-success arm is the one `unavailable` phase, and
            // nothing of the failed call is held.
            expect(machine.leaderboardPhase).toBe('unavailable');
            expect(machine.leaderboard).toBeNull();

            // 7.10: the Player_List still carries one row per Squad_Member.
            expect(machine.players).toHaveLength(scenario.detail.members.length);
            expect(identityMultisetOf(machine.players)).toEqual(
              identityMultisetOf(scenario.detail.members),
            );

            // 7.10: and every row reads as Rating_Unavailable, which is
            // `leaderboardObtained: false` with no entry behind it.
            for (const row of machine.players) {
              expect(row.leaderboardObtained).toBe(false);
              expect(row.ratingEntry).toBeNull();
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 60_000);

  // Feature: web-squads-screens, Property 18: The two calls degrade independently and GetSquad governs membership
  // Validates: Requirements 7.11
  it('produces no player row and drops the leaderboard, for any successful leaderboard against a GetSquad that fails or reports not-found', async () => {
    await fc.assert(
      fc.asyncProperty(
        identityArb.chain((squadId) =>
          membersArb.chain((members) =>
            fc.record({
              squadId: fc.constant(squadId),
              members: fc.constant(members),
              leaderboard: leaderboardForArb(members),
              detail: detailAbsenceArb,
              detailDelay: settleDelayArb,
              leaderboardDelay: settleDelayArb,
            }),
          ),
        ),
        async (scenario) => {
          try {
            const machine = await settleMachine(scenario.squadId, {
              detail: scenario.detail,
              detailDelay: scenario.detailDelay,
              leaderboard: { kind: 'success', value: scenario.leaderboard },
              leaderboardDelay: scenario.leaderboardDelay,
            });

            // 6.4, 6.7: which absence it was decides the phase, and the two are
            // never both true.
            const expectedNotFound = scenario.detail.kind === 'not-found';
            expect(machine.notFound).toBe(expectedNotFound);
            expect(machine.failed).toBe(!expectedNotFound);
            expect(machine.detail).toBeNull();

            // 7.11: a leaderboard that landed while the detail did not renders no
            // Player_Row at all…
            expect(machine.players).toEqual([]);
            expect(machine.adminAuthority).toBe(false);

            // …and its value is dropped rather than held, whichever order the two
            // calls settled in, so nothing downstream can read an identity out of
            // it.
            expect(machine.leaderboard).toBeNull();

            // 7.11: stated as the fact it protects — no display name carried by
            // the leaderboard reaches the row set, even though every entry names a
            // membership that would have had a row.
            const rowNames = new Set(
              machine.players.map((row) => row.displayName),
            );
            for (const entry of scenario.leaderboard.entries) {
              expect(rowNames.has(entry.displayName)).toBe(false);
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 60_000);
});
