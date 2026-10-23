using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Example/unit tests for <see cref="ListMyPendingDeletionSquadsHandler"/>: it asks the owner-scoped
/// source for the caller's squads as of the clock's current instant and returns exactly what the source
/// reports, in its order, succeeding with an empty list when the caller owns no pending-deletion squad
/// (Requirement 17.4). Owner scoping and the purge cut-off are the source's, and are tested against
/// PostgreSQL in <c>PendingDeletionSquadSourceIntegrationTests</c>.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class ListMyPendingDeletionSquadsHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 9, 30, 0, TimeSpan.Zero);

    /// <summary>A source that records what it was asked and answers with a fixed list.</summary>
    private sealed class RecordingSource(IReadOnlyList<PendingDeletionSquad> answer) : IPendingDeletionSquadSource
    {
        public List<(Guid UserId, DateTimeOffset Now)> Calls { get; } = [];

        public Task<IReadOnlyList<PendingDeletionSquad>> ListOwnedByAsync(
            Guid userId,
            DateTimeOffset now,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Calls.Add((userId, now));
            return Task.FromResult(answer);
        }
    }

    [Fact]
    public async Task ReturnsTheSourcesSquads_AskedForTheCallerAtTheClocksInstant()
    {
        var userId = Guid.CreateVersion7();
        PendingDeletionSquad[] squads =
        [
            new(Guid.CreateVersion7(), "Tuesday Five", Now.AddDays(3)),
            new(Guid.CreateVersion7(), "Old Boys", Now.AddDays(29)),
        ];
        var source = new RecordingSource(squads);
        var handler = new ListMyPendingDeletionSquadsHandler(source, new SquadFakeClock(Now));

        Result<IReadOnlyList<PendingDeletionSquad>> result =
            await handler.HandleAsync(new ListMyPendingDeletionSquadsCommand(userId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(squads, result.Value);
        (Guid askedUser, DateTimeOffset askedNow) = Assert.Single(source.Calls);
        Assert.Equal(userId, askedUser);
        Assert.Equal(Now, askedNow);
    }

    [Fact]
    public async Task SucceedsWithAnEmptyList_WhenTheCallerOwnsNoPendingDeletionSquad()
    {
        var handler = new ListMyPendingDeletionSquadsHandler(
            new RecordingSource([]),
            new SquadFakeClock(Now));

        Result<IReadOnlyList<PendingDeletionSquad>> result = await handler.HandleAsync(
            new ListMyPendingDeletionSquadsCommand(Guid.CreateVersion7()),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value!);
    }

    [Fact]
    public async Task RejectsANullCommand()
    {
        var handler = new ListMyPendingDeletionSquadsHandler(
            new RecordingSource([]),
            new SquadFakeClock(Now));

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => handler.HandleAsync(null!, CancellationToken.None));
    }
}
