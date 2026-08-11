using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;
using Result = PitchMate.Domain.LiveTracking.Result;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based tests for keeper-stint recording validation
/// (<see cref="MatchEventValidation.ValidateForRecording"/>) — live-tracking design Property 5.
/// <para>
/// A <see cref="KeeperStintStartedEvent"/> is accepted <em>if and only if</em> its kept team is one of
/// the match's kickoff teams (Requirement 4.4), its keeper is a member of that kept team's roster
/// (Requirement 4.1, 4.3), both required fields are present (Requirement 1.7), and its minute is within
/// the inclusive [0, 200] range (Requirement 4.5 — structurally guaranteed by
/// <see cref="MatchMinute"/>, whose factory accepts only that range, so a candidate can only ever carry
/// a valid minute). On failure the validation identifies the offending field: the missing
/// keeper/kept-team, the invalid team, or the ineligible keeper.
/// </para>
/// <para>
/// The generator spans the whole input space by choosing the kept team among {a valid team, the other
/// valid team, an unknown team, an empty id} and the keeper among {a kept-team roster member, an
/// opposing-team member, a non-participant, an empty id}, over rosters of varying size, running at
/// least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class KeeperStintValidationPropertyTests
{
    private static readonly Guid MatchId = Guid.CreateVersion7();
    private static readonly Guid SquadId = Guid.CreateVersion7();

    // Feature: live-tracking, Property 5: Keeper-stint validation
    // A KeeperStintStarted event validates for recording exactly when its kept team is a valid match
    // team, its keeper is on that team's roster, both fields are present, and its minute is in [0,200];
    // otherwise validation fails identifying the missing field / invalid team / ineligible keeper.
    // Validates: Requirements 1.7, 4.1, 4.3, 4.4, 4.5
    [Property(MaxTest = 100)]
    [Trait("Property", "5")]
    public Property KeeperStintAcceptedExactlyWhenTeamValidAndKeeperOnRoster() =>
        Prop.ForAll(Arb.From(StintCaseGen()), stintCase =>
        {
            Result result = MatchEventValidation.ValidateForRecording(
                stintCase.Candidate,
                stintCase.Rosters,
                stintCase.Participants,
                []);

            if (stintCase.ExpectedValid)
            {
                return result.IsSuccess && result.Error is null;
            }

            return !result.IsSuccess
                && result.Error is { Code: LiveTrackingErrorCode.ValidationFailed }
                && result.Error.Message.Contains(
                    stintCase.ExpectedFailureFragment!,
                    StringComparison.OrdinalIgnoreCase);
        });

    /// <summary>
    /// A generated keeper-stint validation scenario: the candidate event, the match's kickoff-team
    /// rosters and participant set it is validated against, and the expected outcome (whether it should
    /// be accepted and, when rejected, the fragment the failure message must identify).
    /// </summary>
    private sealed record StintCase(
        KeeperStintStartedEvent Candidate,
        IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> Rosters,
        IReadOnlySet<Guid> Participants,
        bool ExpectedValid,
        string? ExpectedFailureFragment);

    /// <summary>
    /// Builds a two-team match lineup of varying roster sizes, then constructs a candidate stint whose
    /// kept team and keeper each independently range over the valid, invalid, and missing cases so the
    /// property exercises acceptance and every rejection branch.
    /// </summary>
    private static Gen<StintCase> StintCaseGen() =>
        from teamASize in Gen.Choose(1, 4)
        from teamBSize in Gen.Choose(1, 4)
        from keptChoice in Gen.Choose(0, 3)
        from keeperChoice in Gen.Choose(0, 3)
        from keeperIndex in Gen.Choose(0, 3)
        from minute in Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue)
        select BuildCase(teamASize, teamBSize, keptChoice, keeperChoice, keeperIndex, minute);

    private static StintCase BuildCase(
        int teamASize,
        int teamBSize,
        int keptChoice,
        int keeperChoice,
        int keeperIndex,
        int minute)
    {
        var teamAId = Guid.CreateVersion7();
        var teamBId = Guid.CreateVersion7();

        IReadOnlyList<Guid> rosterA = FreshMembers(teamASize);
        IReadOnlyList<Guid> rosterB = FreshMembers(teamBSize);

        var rosters = new Dictionary<Guid, IReadOnlyList<Guid>>
        {
            [teamAId] = rosterA,
            [teamBId] = rosterB,
        };
        IReadOnlySet<Guid> participants = new HashSet<Guid>(rosterA.Concat(rosterB));

        Guid keptTeamId = keptChoice switch
        {
            0 => teamAId,
            1 => teamBId,
            2 => Guid.CreateVersion7(), // an unknown team, not one of the match's kickoff teams
            _ => Guid.Empty,            // a missing kept-team field
        };

        Guid keeperMembershipId = keeperChoice switch
        {
            0 => rosterA[keeperIndex % rosterA.Count],
            1 => rosterB[keeperIndex % rosterB.Count],
            2 => Guid.CreateVersion7(), // a non-participant, on no roster
            _ => Guid.Empty,            // a missing keeper field
        };

        var candidate = new KeeperStintStartedEvent(
            Guid.CreateVersion7(),
            MatchId,
            SquadId,
            MatchMinute.Create(minute).Value,
            keeperMembershipId,
            keptTeamId);

        (bool expectedValid, string? fragment) = ExpectedOutcome(rosters, keptTeamId, keeperMembershipId);

        return new StintCase(candidate, rosters, participants, expectedValid, fragment);
    }

    /// <summary>
    /// The oracle: mirrors the required-field, valid-team, and keeper-on-roster rules — in the same
    /// order the validator applies them — to decide whether the candidate should be accepted and, if
    /// not, which field the failure message must identify.
    /// </summary>
    private static (bool ExpectedValid, string? Fragment) ExpectedOutcome(
        IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> rosters,
        Guid keptTeamId,
        Guid keeperMembershipId)
    {
        if (keeperMembershipId == Guid.Empty)
        {
            return (false, "KeeperMembershipId");
        }

        if (keptTeamId == Guid.Empty)
        {
            return (false, "KeptTeamId");
        }

        if (!rosters.TryGetValue(keptTeamId, out var keptRoster))
        {
            return (false, keptTeamId.ToString());
        }

        if (!keptRoster.Contains(keeperMembershipId))
        {
            return (false, keeperMembershipId.ToString());
        }

        return (true, null);
    }

    private static IReadOnlyList<Guid> FreshMembers(int count) =>
        Enumerable.Range(0, count).Select(_ => Guid.CreateVersion7()).ToList();
}
