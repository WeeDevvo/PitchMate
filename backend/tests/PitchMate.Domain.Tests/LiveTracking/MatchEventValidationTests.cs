using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Unit tests for <see cref="MatchEventValidation.ValidateForRecording"/> — the per-event recording
/// validation of a candidate <see cref="MatchEvent"/> against its match's kickoff-lineup teams,
/// participant set, and existing events. They cover the required-field rules (Requirement 1.7); the
/// goal team/scorer/roster rules (Requirement 3.2, 3.3, 3.5, 3.7); the stint team/keeper-roster rules
/// (Requirement 4.3, 4.4); and the retraction target existence, matching-kind, and not-a-retraction
/// rules (Requirement 5.3, 5.4, 5.6).
/// </summary>
[Trait("Feature", "live-tracking")]
public class MatchEventValidationTests
{
    private static readonly Guid MatchId = Guid.CreateVersion7();
    private static readonly Guid SquadId = Guid.CreateVersion7();

    private static readonly Guid TeamAId = Guid.CreateVersion7();
    private static readonly Guid TeamBId = Guid.CreateVersion7();

    private static readonly Guid PlayerA1 = Guid.CreateVersion7();
    private static readonly Guid PlayerA2 = Guid.CreateVersion7();
    private static readonly Guid PlayerB1 = Guid.CreateVersion7();
    private static readonly Guid PlayerB2 = Guid.CreateVersion7();

    private static IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> TeamRosters => new Dictionary<Guid, IReadOnlyList<Guid>>
    {
        [TeamAId] = [PlayerA1, PlayerA2],
        [TeamBId] = [PlayerB1, PlayerB2],
    };

    private static IReadOnlySet<Guid> Participants => new HashSet<Guid> { PlayerA1, PlayerA2, PlayerB1, PlayerB2 };

    private static MatchMinute Minute(int value) => MatchMinute.Create(value).Value;

    private static Result Validate(MatchEvent candidate, IReadOnlyList<MatchEvent>? existing = null) =>
        MatchEventValidation.ValidateForRecording(candidate, TeamRosters, Participants, existing ?? []);

    // ---- Goal events (Requirements 1.7, 3.2, 3.3, 3.5, 3.7) ----

    [Fact]
    public void Goal_WithValidTeamAndRosterScorer_Succeeds()
    {
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), TeamAId, PlayerA1, ownGoal: false);

        Result result = Validate(goal);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Error);
    }

    [Fact]
    public void Goal_WithNoScorer_Succeeds()
    {
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), TeamAId, scorerMembershipId: null, ownGoal: false);

        Result result = Validate(goal);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void Goal_OwnGoalByOpposingPlayer_Succeeds()
    {
        // Own goal credited to Team A, scored by a Team B player: allowed because own-goal scorers need
        // only be a participant, not on the scoring team's roster (Requirement 3.3).
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), TeamAId, PlayerB1, ownGoal: true);

        Result result = Validate(goal);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void Goal_WithEmptyScoringTeam_FailsIdentifyingMissingField()
    {
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), Guid.Empty, PlayerA1, ownGoal: false);

        Result result = Validate(goal);

        AssertValidationFailed(result, "ScoringTeamId");
    }

    [Fact]
    public void Goal_WithUnknownScoringTeam_FailsIdentifyingTeam()
    {
        var unknownTeam = Guid.CreateVersion7();
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), unknownTeam, PlayerA1, ownGoal: false);

        Result result = Validate(goal);

        AssertValidationFailed(result, unknownTeam.ToString());
    }

    [Fact]
    public void Goal_WithNonParticipantScorer_FailsIdentifyingScorer()
    {
        var stranger = Guid.CreateVersion7();
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), TeamAId, stranger, ownGoal: false);

        Result result = Validate(goal);

        AssertValidationFailed(result, stranger.ToString());
    }

    [Fact]
    public void Goal_WithScorerNotOnScoringTeamRoster_FailsWhenNotOwnGoal()
    {
        // PlayerB1 is a participant but on Team B, so cannot be credited a normal goal for Team A.
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), TeamAId, PlayerB1, ownGoal: false);

        Result result = Validate(goal);

        AssertValidationFailed(result, "roster");
    }

    // ---- Keeper stints (Requirements 1.7, 4.3, 4.4) ----

    [Fact]
    public void Stint_WithKeeperOnKeptTeamRoster_Succeeds()
    {
        var stint = new KeeperStintStartedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(0), PlayerB2, TeamBId);

        Result result = Validate(stint);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void Stint_WithEmptyKeeper_FailsIdentifyingMissingField()
    {
        var stint = new KeeperStintStartedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(0), Guid.Empty, TeamBId);

        Result result = Validate(stint);

        AssertValidationFailed(result, "KeeperMembershipId");
    }

    [Fact]
    public void Stint_WithEmptyKeptTeam_FailsIdentifyingMissingField()
    {
        var stint = new KeeperStintStartedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(0), PlayerB2, Guid.Empty);

        Result result = Validate(stint);

        AssertValidationFailed(result, "KeptTeamId");
    }

    [Fact]
    public void Stint_WithUnknownKeptTeam_FailsIdentifyingTeam()
    {
        var unknownTeam = Guid.CreateVersion7();
        var stint = new KeeperStintStartedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(0), PlayerB2, unknownTeam);

        Result result = Validate(stint);

        AssertValidationFailed(result, unknownTeam.ToString());
    }

    [Fact]
    public void Stint_WithKeeperNotOnKeptTeamRoster_FailsIdentifyingKeeper()
    {
        // PlayerA1 is a participant but not on Team B, so is ineligible to keep for Team B.
        var stint = new KeeperStintStartedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(0), PlayerA1, TeamBId);

        Result result = Validate(stint);

        AssertValidationFailed(result, PlayerA1.ToString());
    }

    // ---- Retractions (Requirements 1.7, 5.3, 5.4, 5.6) ----

    [Fact]
    public void GoalRetraction_TargetingExistingGoal_Succeeds()
    {
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), TeamAId, PlayerA1, ownGoal: false);
        var retraction = new GoalRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(11), goal.Id);

        Result result = Validate(retraction, [goal]);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void KeeperStintRetraction_TargetingExistingStint_Succeeds()
    {
        var stint = new KeeperStintStartedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(0), PlayerB2, TeamBId);
        var retraction = new KeeperStintRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(5), stint.Id);

        Result result = Validate(retraction, [stint]);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void Retraction_WithEmptyTarget_FailsIdentifyingMissingField()
    {
        var retraction = new GoalRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(11), Guid.Empty);

        Result result = Validate(retraction);

        AssertValidationFailed(result, "TargetEventId");
    }

    [Fact]
    public void Retraction_WithMissingTarget_FailsWithTargetNotFound()
    {
        var missingTarget = Guid.CreateVersion7();
        var retraction = new GoalRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(11), missingTarget);

        Result result = Validate(retraction, []);

        Assert.False(result.IsSuccess);
        Assert.NotNull(result.Error);
        Assert.Equal(LiveTrackingErrorCode.TargetNotFound, result.Error!.Code);
    }

    [Fact]
    public void GoalRetraction_TargetingAStint_FailsWithKindMismatch()
    {
        var stint = new KeeperStintStartedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(0), PlayerB2, TeamBId);
        var retraction = new GoalRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(11), stint.Id);

        Result result = Validate(retraction, [stint]);

        AssertValidationFailed(result, "must target a GoalScored");
    }

    [Fact]
    public void KeeperStintRetraction_TargetingAGoal_FailsWithKindMismatch()
    {
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), TeamAId, PlayerA1, ownGoal: false);
        var retraction = new KeeperStintRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(11), goal.Id);

        Result result = Validate(retraction, [goal]);

        AssertValidationFailed(result, "must target a KeeperStintStarted");
    }

    [Fact]
    public void Retraction_TargetingAnotherRetraction_FailsCannotRetractARetraction()
    {
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(10), TeamAId, PlayerA1, ownGoal: false);
        var firstRetraction = new GoalRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(11), goal.Id);
        var secondRetraction = new GoalRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(12), firstRetraction.Id);

        Result result = Validate(secondRetraction, [goal, firstRetraction]);

        AssertValidationFailed(result, "cannot be retracted");
    }

    private static void AssertValidationFailed(Result result, string expectedMessageFragment)
    {
        Assert.False(result.IsSuccess);
        Assert.NotNull(result.Error);
        Assert.Equal(LiveTrackingErrorCode.ValidationFailed, result.Error!.Code);
        Assert.Contains(expectedMessageFragment, result.Error.Message, StringComparison.OrdinalIgnoreCase);
    }
}
