using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
using MatchState = PitchMate.Domain.Matches.MatchState;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Example-based success- and failure-path tests for <see cref="RecordEventBatchHandler"/>: the
/// feature-gate, match-state, empty-batch, and mixed-classification behaviours that complement the
/// universal properties. Each test drives the real handler over the in-memory
/// <see cref="RecordEventBatchWorld"/> (no database).
/// </summary>
[Trait("Feature", "live-tracking")]
public class RecordEventBatchHandlerTests
{
    [Fact]
    public void RecordingIsRejectedWhenLiveTrackingIsNotEnabled()
    {
        RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress, liveTrackingEnabled: false);

        Result<BatchResult> result = world.Record(world.ValidGoal());

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.NotEnabled, result.Error!.Code);
        Assert.Equal(0, world.Events.TotalCount);
    }

    [Theory]
    [InlineData(MatchState.GatheringAvailability)]
    [InlineData(MatchState.Confirmed)]
    [InlineData(MatchState.TeamsRolled)]
    public void RecordingIsRejectedWhenMatchHasNotStarted(MatchState state)
    {
        RecordEventBatchWorld world = RecordEventBatchWorld.Build(state);

        Guid team = world.TeamAId == Guid.Empty ? Guid.NewGuid() : world.TeamAId;
        Result<BatchResult> result = world.Record(new EventSubmission(Guid.CreateVersion7(), EventKind.GoalScored, 10, ScoringTeamId: team));

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.MatchNotStarted, result.Error!.Code);
        Assert.Equal(0, world.Events.TotalCount);
    }

    [Theory]
    [InlineData(MatchState.Completed)]
    [InlineData(MatchState.Cancelled)]
    public void RecordingANewEventIsRejectedWhenTheLogIsSealed(MatchState state)
    {
        RecordEventBatchWorld world = RecordEventBatchWorld.Build(state);

        Result<BatchResult> result = world.Record(new EventSubmission(Guid.CreateVersion7(), EventKind.GoalScored, 10, ScoringTeamId: world.TeamAId));

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.LogSealed, result.Error!.Code);
        Assert.Equal(0, world.Events.TotalCount);
    }

    [Fact]
    public void ADuplicateEventForASealedMatchIsClassifiedDuplicateAndLeavesTheLogUnchanged()
    {
        RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.Completed);

        var present = new GoalScoredEvent(
            Guid.CreateVersion7(), world.Match.Id, world.SquadId,
            MatchMinute.Create(8).Value, world.TeamAId, null, ownGoal: false);
        world.Events.Seed(present);

        Result<BatchResult> result = world.Record(new EventSubmission(present.Id, EventKind.GoalScored, 8, ScoringTeamId: world.TeamAId));

        Assert.True(result.IsSuccess);
        Assert.Equal(EventOutcome.Duplicate, result.Value!.Outcomes.Single().Outcome);
        Assert.Equal(1, world.Events.TotalCount);
    }

    [Fact]
    public void AnEmptyBatchIsRejectedAsAValidationFailure()
    {
        RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress);

        Result<BatchResult> result = world.Record();

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.ValidationFailed, result.Error!.Code);
        Assert.Equal(0, world.Events.TotalCount);
    }

    [Fact]
    public void AMixedBatchClassifiesEachEventAndAppendsOnlyValidNonDuplicates()
    {
        RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress);

        // A pre-existing event so a submission carrying its id is a duplicate.
        var present = new GoalScoredEvent(
            Guid.CreateVersion7(), world.Match.Id, world.SquadId,
            MatchMinute.Create(3).Value, world.TeamAId, null, ownGoal: false);
        world.Events.Seed(present);

        EventSubmission validGoal = world.ValidGoal(minute: 20, scorer: world.TeamARoster[0]);
        EventSubmission validStint = new(
            Guid.CreateVersion7(), EventKind.KeeperStintStarted, 0,
            KeeperMembershipId: world.TeamARoster[0], KeptTeamId: world.TeamAId);
        EventSubmission duplicateOfPresent = new(present.Id, EventKind.GoalScored, 3, ScoringTeamId: world.TeamAId);
        EventSubmission invalidMinute = new(Guid.CreateVersion7(), EventKind.GoalScored, 999, ScoringTeamId: world.TeamAId);
        EventSubmission invalidTeam = new(Guid.CreateVersion7(), EventKind.GoalScored, 15, ScoringTeamId: Guid.NewGuid());
        EventSubmission intraDuplicate = validGoal with { };

        Result<BatchResult> result = world.Record(
            validGoal, duplicateOfPresent, invalidMinute, validStint, invalidTeam, intraDuplicate);

        Assert.True(result.IsSuccess);
        IReadOnlyList<RecordOutcome> outcomes = result.Value!.Outcomes;

        Assert.Equal(EventOutcome.Applied, outcomes[0].Outcome);   // validGoal
        Assert.Equal(EventOutcome.Duplicate, outcomes[1].Outcome); // duplicateOfPresent
        Assert.Equal(EventOutcome.Rejected, outcomes[2].Outcome);  // invalidMinute
        Assert.Equal(EventOutcome.Applied, outcomes[3].Outcome);   // validStint
        Assert.Equal(EventOutcome.Rejected, outcomes[4].Outcome);  // invalidTeam
        Assert.Equal(EventOutcome.Duplicate, outcomes[5].Outcome); // intraDuplicate of validGoal

        Assert.NotNull(outcomes[2].Error);
        Assert.NotNull(outcomes[4].Error);

        // The seed plus exactly the two valid, non-duplicate events were appended.
        Assert.Equal(3, world.Events.TotalCount);
        var storedIds = world.Events.Stored(world.Match.Id).Select(e => e.Id).ToHashSet();
        Assert.Contains(validGoal.EventId, storedIds);
        Assert.Contains(validStint.EventId, storedIds);
        Assert.DoesNotContain(invalidMinute.EventId, storedIds);
        Assert.DoesNotContain(invalidTeam.EventId, storedIds);
    }

    [Fact]
    public void RecordingAppendsAndCommitsExactlyOnceForAcceptedEvents()
    {
        RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress);

        Result<BatchResult> result = world.Record(world.ValidGoal(), world.ValidGoal(minute: 30));

        Assert.True(result.IsSuccess);
        Assert.Equal(2, world.Events.TotalCount);
        Assert.Equal(1, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public void RecordingCommitsNothingWhenEveryEventIsRejectedOrDuplicate()
    {
        RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress);

        Result<BatchResult> result = world.Record(
            new EventSubmission(Guid.CreateVersion7(), EventKind.GoalScored, 15, ScoringTeamId: Guid.NewGuid()));

        Assert.True(result.IsSuccess);
        Assert.Equal(EventOutcome.Rejected, result.Value!.Outcomes.Single().Outcome);
        Assert.Equal(0, world.Events.TotalCount);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }
}
