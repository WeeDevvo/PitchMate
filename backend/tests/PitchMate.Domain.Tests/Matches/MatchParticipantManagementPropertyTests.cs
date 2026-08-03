using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for participant management on a confirmed match (match-lifecycle design
/// Property 9).
/// <para>
/// For any match in <see cref="MatchState.Confirmed"/> and any sequence of add/remove operations,
/// the aggregate must preserve the no-duplicate participant set (Requirement 7.1, 7.2, 7.3, 7.4,
/// 7.5, 7.7):
/// <list type="bullet">
///   <item>an eligible membership (active, belonging to the match's squad) that is added becomes
///   exactly one participant (Requirement 7.1);</item>
///   <item>adding an already-present membership again is rejected with
///   <see cref="MatchErrorCode.AlreadyParticipant"/> while a single participant is retained
///   (Requirement 7.4);</item>
///   <item>removing a current participant makes that membership absent (Requirement 7.2);</item>
///   <item>removing a membership that is not a participant is rejected with
///   <see cref="MatchErrorCode.NotAParticipant"/> and leaves the set unchanged (Requirement 7.5);</item>
///   <item>an ineligible membership — one belonging to another squad or whose state is
///   <see cref="MembershipState.Inactive"/> — is always rejected with
///   <see cref="MatchErrorCode.ValidationFailed"/> and never joins the set (Requirement 7.3).</item>
/// </list>
/// The test drives a randomised sequence of add/remove operations against the <see cref="Match"/>
/// aggregate and, in lock-step, against an independent oracle set, asserting the result code and the
/// full invariant (set equality, no duplicates, state unchanged) after every operation. The property
/// runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchParticipantManagementPropertyTests
{
    /// <summary>The clock instant the generated match is drafted against; the candidate day is strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Feature: match-lifecycle, Property 9: Participant management preserves the no-duplicate set -
    // for any match in Confirmed and any sequence of add/remove operations, an eligible membership
    // (active, belonging to the squad) that is added becomes exactly one participant; adding it again
    // is rejected while leaving a single participant; removing a participant makes it absent; and
    // removing a non-participant is rejected leaving the set unchanged. An ineligible membership
    // (wrong squad or inactive) is always rejected.
    // Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.7
    [Property(MaxTest = 100)]
    [Trait("Property", "9")]
    public Property ParticipantManagementPreservesNoDuplicateSet() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var squadId = Guid.NewGuid();
            var match = ConfirmedMatch(squadId);

            // Build the concrete membership pool from the specs. An eligible membership is active and
            // belongs to this squad; an ineligible one belongs to another squad or is inactive.
            var pool = scenario.Pool.Select(spec => BuildMembership(spec, squadId)).ToArray();

            // The oracle: the set of membership ids the aggregate should currently hold as participants.
            var expected = new HashSet<Guid>();

            foreach (var op in scenario.Operations)
            {
                var membership = pool[op.PoolIndex];
                var isEligible = membership.SquadId == squadId && membership.State == MembershipState.Active;

                if (op.IsAdd)
                {
                    var result = match.AddParticipant(membership);

                    if (!isEligible)
                    {
                        // Ineligible: rejected as ValidationFailed, participant set unchanged (7.3).
                        if (result.IsSuccess || result.Error!.Code != MatchErrorCode.ValidationFailed)
                        {
                            return false;
                        }
                    }
                    else if (expected.Contains(membership.Id))
                    {
                        // Duplicate add: rejected as AlreadyParticipant, still exactly one (7.4).
                        if (result.IsSuccess || result.Error!.Code != MatchErrorCode.AlreadyParticipant)
                        {
                            return false;
                        }
                    }
                    else
                    {
                        // Eligible and new: added as exactly one participant (7.1).
                        if (!result.IsSuccess || result.Value is null
                            || result.Value!.SquadMembershipId != membership.Id)
                        {
                            return false;
                        }

                        expected.Add(membership.Id);
                    }
                }
                else
                {
                    // Remove either a pooled membership's id or a fresh id belonging to no membership.
                    var targetId = op.RemoveByForeignId ? Guid.NewGuid() : membership.Id;
                    var result = match.RemoveParticipant(targetId);

                    if (expected.Contains(targetId))
                    {
                        // Current participant: removed and now absent (7.2).
                        if (!result.IsSuccess)
                        {
                            return false;
                        }

                        expected.Remove(targetId);
                    }
                    else
                    {
                        // Not a participant: rejected as NotAParticipant, set unchanged (7.5).
                        if (result.IsSuccess || result.Error!.Code != MatchErrorCode.NotAParticipant)
                        {
                            return false;
                        }
                    }
                }

                // Invariant after every operation: the aggregate's participant set equals the oracle,
                // holds no duplicates, and remains in Confirmed (add/remove never change state).
                var actual = match.Participants.Select(p => p.SquadMembershipId).ToHashSet();
                if (!actual.SetEquals(expected)
                    || match.Participants.Count != actual.Count
                    || match.State != MatchState.Confirmed)
                {
                    return false;
                }
            }

            return true;
        });

    /// <summary>
    /// Creates a match drafted for <paramref name="squadId"/> and confirmed with an empty participant
    /// pool (no availability responses, a zero threshold met by a zero available count), leaving it in
    /// <see cref="MatchState.Confirmed"/> ready for participant management.
    /// </summary>
    private static Match ConfirmedMatch(Guid squadId)
    {
        var day = NowUtc.AddDays(7);
        var match = Match.CreateDraft(Guid.Empty, squadId, "Community Astro Pitch", [day], NowUtc).Value!;
        match.Confirm(day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
        return match;
    }

    /// <summary>Builds a concrete squad membership from <paramref name="spec"/> for the match's squad <paramref name="squadId"/>.</summary>
    private static SquadMembership BuildMembership(MembershipSpec spec, Guid squadId)
    {
        // Wrong-squad memberships belong to a different squad; all others belong to the match's squad.
        var owningSquadId = spec.Kind == MembershipKind.WrongSquad ? Guid.NewGuid() : squadId;

        var membership = spec.IsGuest
            ? SquadMembership.CreateGuest(owningSquadId, spec.DisplayName, skillTier: null, NowUtc).Value!
            : SquadMembership.CreateRegistered(owningSquadId, Guid.NewGuid(), spec.DisplayName).Value!;

        if (spec.Kind == MembershipKind.Inactive)
        {
            membership.Deactivate();
        }

        return membership;
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>How a generated membership relates to the match's squad and its eligibility.</summary>
    private enum MembershipKind
    {
        /// <summary>Active and belonging to the match's squad — eligible to be added.</summary>
        Eligible,

        /// <summary>Active but belonging to a different squad — ineligible.</summary>
        WrongSquad,

        /// <summary>Belonging to the match's squad but inactive — ineligible.</summary>
        Inactive
    }

    /// <summary>A generated membership: its eligibility kind, backing (registered vs guest), and display name.</summary>
    private sealed record MembershipSpec(MembershipKind Kind, bool IsGuest, string DisplayName);

    /// <summary>A single generated operation over the membership pool: an add, or a remove (by pool id or a foreign id).</summary>
    private sealed record OpSpec(bool IsAdd, int PoolIndex, bool RemoveByForeignId);

    /// <summary>A generated participant-management scenario: a membership pool and a sequence of operations.</summary>
    private sealed record Scenario(MembershipSpec[] Pool, OpSpec[] Operations);

    /// <summary>
    /// Generates a pool of 1..8 memberships (a mix of eligible, wrong-squad, and inactive; registered
    /// or guest) and a sequence of 0..24 add/remove operations over that pool. Remove operations either
    /// target a pooled membership's id or a foreign id belonging to no membership, so both the
    /// participant and non-participant removal branches are exercised. Repeated adds of the same pool
    /// index drive the duplicate-add branch.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from poolSize in Gen.Choose(1, 8)
        from pool in Gen.ArrayOf(MembershipSpecGen(), poolSize)
        from opCount in Gen.Choose(0, 24)
        from operations in Gen.ArrayOf(OpSpecGen(poolSize), opCount)
        select new Scenario(WithDistinctNames(pool), operations);

    /// <summary>Generates one membership spec: an eligibility kind and a backing choice.</summary>
    private static Gen<MembershipSpec> MembershipSpecGen() =>
        from kind in Gen.Elements(MembershipKind.Eligible, MembershipKind.WrongSquad, MembershipKind.Inactive)
        from isGuest in Gen.Elements(true, false)
        select new MembershipSpec(kind, isGuest, DisplayName: string.Empty);

    /// <summary>Generates one operation over a pool of <paramref name="poolSize"/> memberships.</summary>
    private static Gen<OpSpec> OpSpecGen(int poolSize) =>
        from isAdd in Gen.Elements(true, false)
        from poolIndex in Gen.Choose(0, poolSize - 1)
        from removeByForeignId in Gen.Elements(true, false)
        select new OpSpec(isAdd, poolIndex, removeByForeignId);

    /// <summary>Assigns each membership spec a distinct display name (names are unique within a squad).</summary>
    private static MembershipSpec[] WithDistinctNames(MembershipSpec[] pool) =>
        [.. pool.Select((spec, i) => spec with { DisplayName = $"Player {i}" })];
}
