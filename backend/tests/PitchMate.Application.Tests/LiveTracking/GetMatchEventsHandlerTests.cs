using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
using static PitchMate.Application.Tests.LiveTracking.GetRunningScoreHandlerTests;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Example-based tests for <see cref="GetMatchEventsHandler"/>: an active member reads every accepted
/// event of the match, retractions included, in the order the events were minted however they were
/// stored; and a non-member, an inactive membership, a request with no authenticated subject, a match
/// that cannot be found, and a squad in its deletion grace period all receive the one uniform
/// <see cref="LiveTrackingErrorCode.Unauthorized"/> failure carrying no events. Driven through the
/// running-score harness, which stages the same in-play match and membership set.
/// </summary>
[Trait("Feature", "live-tracking")]
public class GetMatchEventsHandlerTests
{
    private static readonly DateTimeOffset Kickoff = new(2025, 1, 8, 19, 0, 0, TimeSpan.Zero);

    [Fact]
    public void AnActiveMemberReadsEveryEventOldestFirstRetractionsIncluded()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();
        Guid keeperId = Guid.NewGuid();

        var goal = new GoalScoredEvent(
            IdAt(1), world.Match.Id, world.SquadId, Minute(3), world.TeamAId, scorerMembershipId: null, ownGoal: false);
        var stint = new KeeperStintStartedEvent(IdAt(2), world.Match.Id, world.SquadId, Minute(5), keeperId, world.TeamBId);
        var retraction = new GoalRetractedEvent(IdAt(3), world.Match.Id, world.SquadId, Minute(6), goal.Id);

        // Stored out of order: the read orders by Event_Id, not by storage.
        world.Seed(retraction, goal, stint);

        Result<GetMatchEventsResult> result = world.ReadEvents(world.ActiveMemberUserId, world.Match.Id);

        Assert.True(result.IsSuccess, result.Error?.Message);
        Assert.Equal(world.Match.Id, result.Value!.MatchId);
        Assert.Equal([goal.Id, stint.Id, retraction.Id], result.Value.Events.Select(matchEvent => matchEvent.Id));
    }

    [Fact]
    public void AMatchWithNoEventsReadsAsAnEmptyLog()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();

        Result<GetMatchEventsResult> result = world.ReadEvents(world.OwnerUserId, world.Match.Id);

        Assert.True(result.IsSuccess, result.Error?.Message);
        Assert.Empty(result.Value!.Events);
    }

    [Fact]
    public void ANonMemberAnInactiveMemberAndAnAnonymousRequestAreRefusedUniformly()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();
        world.SeedGoal(world.TeamAId, 5);

        foreach (Guid actor in new[] { world.NonMemberUserId, world.InactiveMemberUserId, Guid.Empty })
        {
            Result<GetMatchEventsResult> result = world.ReadEvents(actor, world.Match.Id);

            Assert.False(result.IsSuccess);
            Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
            Assert.Null(result.Value);
        }
    }

    [Fact]
    public void AMatchThatCannotBeFoundIsRefusedLikeOneTheCallerMayNotSee()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();

        Result<GetMatchEventsResult> result = world.ReadEvents(world.OwnerUserId, Guid.CreateVersion7());

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
    }

    [Fact]
    public void ASquadPendingDeletionIsRefusedToAnActiveMember()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build(squadPendingDeletion: true);
        world.SeedGoal(world.TeamAId, 5);

        Result<GetMatchEventsResult> result = world.ReadEvents(world.ActiveMemberUserId, world.Match.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
        Assert.Null(result.Value);
    }

    private static Guid IdAt(int secondsAfterKickoff) => Guid.CreateVersion7(Kickoff.AddSeconds(secondsAfterKickoff));

    private static MatchMinute Minute(int value) => MatchMinute.Create(value).Value!;
}
