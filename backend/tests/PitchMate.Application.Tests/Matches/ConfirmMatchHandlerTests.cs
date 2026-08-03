using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Tests.Squads;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using ConfirmResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.ConfirmMatchResult>;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="ConfirmMatchHandler"/>'s threshold resolution and its post-commit,
/// best-effort notification isolation boundary (task 15.2, Requirements 6.3, 6.6). They drive the
/// real handler against in-memory fakes — a match seeded in <see cref="MatchState.GatheringAvailability"/>
/// with availability responses, the committed squad fakes supplying the acting owner and the active
/// registered members, a unit of work modelling the commit boundary, and a capturing publisher that
/// observes every publish attempt — with a controllable clock so candidate-day future-dating is
/// deterministic.
/// <para>
/// The default minimum player threshold is 10. Because the <see cref="Squad"/> aggregate exposes no
/// squad-configurable <c>Minimum_Player_Threshold</c> today, the handler's
/// <see cref="ConfirmMatchHandler.DefaultMinimumPlayerThreshold"/> is the effective value; the
/// threshold tests therefore pin the default by asserting the boundary — exactly 10 available members
/// confirms, and 9 is rejected as below the threshold (Requirement 6.3).
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class ConfirmMatchHandlerTests
{
    /// <summary>A fixed UTC anchor the fake clock reads from; the candidate day sits well after it.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The single, valid, strictly-future candidate day the match is confirmed on.</summary>
    private static readonly DateTimeOffset ConfirmedDay = Anchor.AddDays(7);

    private const string Location = "Hackney Marshes, Pitch 12";

    // Requirement 6.3: with no squad-configured threshold, the default of 10 applies — exactly 10
    // available active registered members meets it, so the match confirms and seeds all ten.
    [Fact]
    public async Task DefaultThreshold_ExactlyTenAvailable_Confirms()
    {
        Harness h = Harness.With(availableMembers: 10, ConfirmPublisherMode.Success);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(h.MatchId, result.Value!.MatchId);
        Assert.Equal(ConfirmedDay.ToUniversalTime(), result.Value!.ConfirmedDay);
        Assert.Equal(10, result.Value!.ParticipantCount);
        Assert.Equal(MatchState.Confirmed, h.Match.State);
    }

    // Requirement 6.3: with the default threshold of 10, nine available members is below it, so
    // confirmation is rejected as ThresholdNotMet and the match is left gathering availability.
    [Fact]
    public async Task DefaultThreshold_NineAvailable_RejectedAsThresholdNotMet()
    {
        Harness h = Harness.With(availableMembers: 9, ConfirmPublisherMode.Success);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.ThresholdNotMet, result.Error!.Code);
        Assert.Equal(MatchState.GatheringAvailability, h.Match.State);
        Assert.Null(h.Match.ConfirmedDay);
        Assert.Empty(h.Match.Participants);
        // A rejected confirmation never commits and never publishes.
        Assert.Equal(0, h.UnitOfWork.SaveCallCount);
        Assert.Empty(h.Publisher.Calls);
    }

    // Requirement 6.6: a successful confirmation raises exactly one MatchConfirmed event, after the
    // confirmation has committed, as a squad broadcast naming no directed targets.
    [Fact]
    public async Task SuccessfulConfirmation_PublishesExactlyOneMatchConfirmedAfterCommit()
    {
        Harness h = Harness.With(availableMembers: 10, ConfirmPublisherMode.Success);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, h.UnitOfWork.SaveCallCount);

        CapturingConfirmPublisher.PublishCall call = Assert.Single(h.Publisher.Calls);
        Assert.Equal(NotificationType.MatchConfirmed, call.Type);
        Assert.Equal(h.SquadId, call.SquadId);
        Assert.Empty(call.DirectedTargetMembershipIds);
        Assert.True(call.CommittedAtPublish);
    }

    // Requirement 6.6: a publish that returns a failure result is isolated; the confirmation still
    // succeeds and the committed match is retained.
    [Fact]
    public async Task PublishFailureResult_IsIsolatedAndReportedAsSuccess()
    {
        Harness h = Harness.With(availableMembers: 10, ConfirmPublisherMode.FailureResult);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(MatchState.Confirmed, h.Match.State);
        Assert.True(h.UnitOfWork.HasCommitted);
        Assert.Single(h.Publisher.Calls);
    }

    // Requirement 6.6: a publish that throws is caught; the confirmation still succeeds and the
    // committed match is retained.
    [Fact]
    public async Task PublishThrows_IsIsolatedAndReportedAsSuccess()
    {
        Harness h = Harness.With(availableMembers: 10, ConfirmPublisherMode.Throws);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(MatchState.Confirmed, h.Match.State);
        Assert.True(h.UnitOfWork.HasCommitted);
        Assert.Single(h.Publisher.Calls);
    }

    // Requirement 6.6: when the commit fails (rolls back), no MatchConfirmed event is published.
    [Fact]
    public async Task RolledBackCommit_PublishesNothing()
    {
        Harness h = Harness.With(availableMembers: 10, ConfirmPublisherMode.Success, throwOnSave: true);

        // The commit throws and the handler does not swallow it, so the failure surfaces to the caller.
        await Assert.ThrowsAsync<InvalidOperationException>(() => h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.MatchId, ConfirmedDay),
            CancellationToken.None));

        Assert.Equal(1, h.UnitOfWork.SaveCallCount);
        Assert.False(h.UnitOfWork.HasCommitted);
        Assert.Empty(h.Publisher.Calls);
    }

    /// <summary>
    /// Wires a <see cref="ConfirmMatchHandler"/> to in-memory fakes: a committed squad with an active
    /// owner (so the organiser gate passes and the squad name renders) and a given number of active
    /// registered members who each marked the confirmed day, a match seeded in
    /// <see cref="MatchState.GatheringAvailability"/> carrying those members' availability responses, a
    /// unit of work modelling the commit boundary, and a capturing publisher in the requested mode.
    /// </summary>
    private sealed class Harness
    {
        public required ConfirmMatchHandler Handler { get; init; }
        public required Match Match { get; init; }
        public required ConfirmFakeUnitOfWork UnitOfWork { get; init; }
        public required CapturingConfirmPublisher Publisher { get; init; }
        public required Guid SquadId { get; init; }
        public required Guid MatchId { get; init; }
        public required Guid OwnerUserId { get; init; }

        public static Harness With(int availableMembers, ConfirmPublisherMode mode, bool throwOnSave = false)
        {
            var squadStore = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            squadStore.AddCommittedSquad(squad);

            // The acting owner: an active registered organiser of the squad. The owner does not mark
            // availability, so it is neither counted nor seeded — keeping the available count equal to
            // the number of dedicated available members.
            Guid ownerUserId = Guid.NewGuid();
            squadStore.AddCommittedMembership(
                SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

            // The match, drafted in GatheringAvailability with the single candidate day.
            Match match = Match.CreateDraft(
                Guid.CreateVersion7(),
                squad.Id,
                Location,
                new[] { ConfirmedDay },
                Anchor).Value!;

            // Seed the requested number of active registered members, each marking the confirmed day so
            // they count towards the available tally and are seeded as participants on confirmation.
            for (int i = 0; i < availableMembers; i++)
            {
                SquadMembership member =
                    SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), $"Player {i + 1}").Value!;
                squadStore.AddCommittedMembership(member);

                match.SubmitAvailability(member.Id, new[] { ConfirmedDay }, Anchor.AddHours(i + 1));
            }

            var unitOfWork = new ConfirmFakeUnitOfWork(throwOnSave);
            var publisher = new CapturingConfirmPublisher(mode, unitOfWork);

            var handler = new ConfirmMatchHandler(
                new ConfirmFakeMatchRepository(match),
                new ConfirmFakeAvailabilityRepository(match.AvailabilityResponses.ToList()),
                new FakeSquadMembershipRepository(squadStore),
                new FakeSquadRepository(squadStore),
                unitOfWork,
                publisher,
                NullLogger<ConfirmMatchHandler>.Instance);

            return new Harness
            {
                Handler = handler,
                Match = match,
                UnitOfWork = unitOfWork,
                Publisher = publisher,
                SquadId = squad.Id,
                MatchId = match.Id,
                OwnerUserId = ownerUserId,
            };
        }
    }
}
