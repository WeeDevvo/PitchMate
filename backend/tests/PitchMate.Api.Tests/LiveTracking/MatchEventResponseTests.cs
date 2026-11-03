using PitchMate.Api.LiveTracking.Endpoints;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Api.Tests.LiveTracking;

/// <summary>
/// Each event kind reaches the event-log read in the shape a client submits it: its identity, kind and
/// minute, the members its kind carries, and null (or false) for the rest.
/// </summary>
public sealed class MatchEventResponseTests
{
    private static readonly Guid MatchId = Guid.CreateVersion7();
    private static readonly Guid SquadId = Guid.CreateVersion7();
    private static readonly Guid TeamId = Guid.CreateVersion7();
    private static readonly Guid PlayerId = Guid.CreateVersion7();

    [Fact]
    public void AGoalCarriesItsTeamScorerAndOwnGoalFlagOnly()
    {
        var goal = new GoalScoredEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(12), TeamId, PlayerId, ownGoal: true);

        Assert.Equal(
            new MatchEventResponse(goal.Id, EventKind.GoalScored, 12, TeamId, PlayerId, true, null, null, null),
            MatchEventResponse.From(goal));
    }

    [Fact]
    public void AKeeperStintCarriesItsKeeperAndTeamOnly()
    {
        var stint = new KeeperStintStartedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(20), PlayerId, TeamId);

        Assert.Equal(
            new MatchEventResponse(stint.Id, EventKind.KeeperStintStarted, 20, null, null, false, PlayerId, TeamId, null),
            MatchEventResponse.From(stint));
    }

    [Fact]
    public void ARetractionCarriesItsTargetOnly()
    {
        Guid target = Guid.CreateVersion7();
        var goalRetraction = new GoalRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(30), target);
        var stintRetraction = new KeeperStintRetractedEvent(Guid.CreateVersion7(), MatchId, SquadId, Minute(31), target);

        Assert.Equal(
            new MatchEventResponse(goalRetraction.Id, EventKind.GoalRetracted, 30, null, null, false, null, null, target),
            MatchEventResponse.From(goalRetraction));
        Assert.Equal(
            new MatchEventResponse(stintRetraction.Id, EventKind.KeeperStintRetracted, 31, null, null, false, null, null, target),
            MatchEventResponse.From(stintRetraction));
    }

    private static MatchMinute Minute(int value) => MatchMinute.Create(value).Value!;
}
