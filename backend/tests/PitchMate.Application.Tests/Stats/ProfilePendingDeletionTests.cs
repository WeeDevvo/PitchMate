using PitchMate.Application.Stats;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Application.Tests.Stats;

/// <summary>
/// Example-based test for <see cref="GetPlayerProfileHandler"/> over a squad in its deletion grace
/// period. Soft-deleting a squad leaves its memberships active, so the handler must refuse the read
/// itself, with the same uniform <see cref="StatsErrorCode.Unauthorized"/> failure a non-member gets,
/// before any statistics are read.
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class ProfilePendingDeletionTests
{
    [Fact]
    public async Task Squad_pending_deletion_is_rejected_uniformly()
    {
        Squad squad = Squad.Create("The Squad").Value!;
        Guid userId = Guid.NewGuid();
        SquadMembership requester = SquadMembership.CreateRegistered(squad.Id, userId, "Requester").Value!;

        // The stats repository throws, so reaching it would surface as ComputationFailed instead.
        var handler = new GetPlayerProfileHandler(
            new FakeStatsMembershipRepository(requester, squadPendingDeletion: true),
            new FakeStatsSquadRepository(squad),
            new FakeStatsRepository(throwOnAggregate: true),
            new FakeDisplayRatingParametersSource(DisplayRatingParameters.Default),
            new FakeRichStatsSource(),
            new ThresholdRatingEngine());

        var result = await handler.HandleAsync(
            new GetPlayerProfileCommand(userId, squad.Id, requester.Id),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(StatsErrorCode.Unauthorized, result.Error!.Code);
        Assert.Null(result.Value);
    }
}
