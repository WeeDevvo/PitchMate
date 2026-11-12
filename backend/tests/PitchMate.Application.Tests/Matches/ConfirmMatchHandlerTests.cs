using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Tests.Squads;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using ConfirmResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.ConfirmMatchResult>;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="ConfirmMatchHandler"/>'s seeding and its post-commit,
/// best-effort notification isolation boundary (task 15.2, Requirements 6.3, 6.6). They drive the
/// real handler against in-memory fakes — a match seeded in <see cref="MatchState.GatheringAvailability"/>
/// with availability responses, the committed squad fakes supplying the acting owner and the active
/// registered members, a unit of work modelling the commit boundary, and a capturing publisher that
/// observes every publish attempt — with a controllable clock so candidate-day future-dating is
/// deterministic.
/// <para>
/// There is no minimum player count: any candidate day confirms, seeding whoever marked it, guests
/// included, and more players join or are added afterwards.
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

    // Availability is a guide: a day only one member marked still confirms, with that member playing.
    [Fact]
    public async Task OneMarkedMember_Confirms_AndIsTheOnlyPlayer()
    {
        Harness h = Harness.With(availableMembers: 1, ConfirmPublisherMode.Success);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.SquadId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(h.MatchId, result.Value!.MatchId);
        Assert.Equal(ConfirmedDay.ToUniversalTime(), result.Value!.ConfirmedDay);
        Assert.Equal(1, result.Value!.ParticipantCount);
        Assert.Equal(MatchState.Confirmed, h.Match.State);
    }

    // Nobody marking the day doesn't stop it: the match confirms with no players yet, to be joined.
    [Fact]
    public async Task NobodyMarked_StillConfirms_WithNoPlayers()
    {
        Harness h = Harness.With(availableMembers: 0, ConfirmPublisherMode.Success);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.SquadId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value!.ParticipantCount);
        Assert.Equal(MatchState.Confirmed, h.Match.State);
        Assert.Equal(1, h.UnitOfWork.SaveCallCount);
    }

    // A guest whose availability an admin marked is seeded as a guest participant on confirmation.
    [Fact]
    public async Task MarkedGuests_AreSeededAsGuests()
    {
        Harness h = Harness.With(availableMembers: 2, ConfirmPublisherMode.Success, availableGuests: 3);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.SquadId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(5, result.Value!.ParticipantCount);
        Assert.Equal(
            ["Guest 1", "Guest 2", "Guest 3"],
            h.Match.Participants.Where(p => p.IsGuest).Select(p => p.DisplayName).Order().ToArray());
    }

    // A guest that has since gone inactive isn't seeded, even with a stored marking.
    [Fact]
    public async Task InactiveGuest_IsNotSeeded()
    {
        Harness h = Harness.With(
            availableMembers: 2, ConfirmPublisherMode.Success, availableGuests: 1, inactiveAvailableGuests: 1);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.SquadId, h.MatchId, ConfirmedDay),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(["Guest 1"], h.Match.Participants.Where(p => p.IsGuest).Select(p => p.DisplayName).ToArray());
    }

    // Requirement 6.6: a successful confirmation raises exactly one MatchConfirmed event, after the
    // confirmation has committed, as a squad broadcast naming no directed targets.
    [Fact]
    public async Task SuccessfulConfirmation_PublishesExactlyOneMatchConfirmedAfterCommit()
    {
        Harness h = Harness.With(availableMembers: 10, ConfirmPublisherMode.Success);

        ConfirmResult result = await h.Handler.HandleAsync(
            new ConfirmMatchCommand(h.OwnerUserId, h.SquadId, h.MatchId, ConfirmedDay),
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
            new ConfirmMatchCommand(h.OwnerUserId, h.SquadId, h.MatchId, ConfirmedDay),
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
            new ConfirmMatchCommand(h.OwnerUserId, h.SquadId, h.MatchId, ConfirmedDay),
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
            new ConfirmMatchCommand(h.OwnerUserId, h.SquadId, h.MatchId, ConfirmedDay),
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

        public static Harness With(
            int availableMembers,
            ConfirmPublisherMode mode,
            bool throwOnSave = false,
            int availableGuests = 0,
            int inactiveAvailableGuests = 0)
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

            // The responses are marked on one instance of the match and stored in the availability
            // repository; the handler is given a second instance with the same identity and none
            // loaded, as the real match repository returns it. So a seed that read the responses off
            // the aggregate instead of from storage would seed nobody and fail these tests.
            Guid matchId = Guid.CreateVersion7();
            Match marked = Match.CreateDraft(
                matchId,
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

                marked.SubmitAvailability(member.Id, new[] { ConfirmedDay }, Anchor.AddHours(i + 1));
            }

            // Guests whose availability an admin marked for the confirmed day. An inactive guest's
            // marking stays stored but no longer counts.
            for (int i = 0; i < availableGuests + inactiveAvailableGuests; i++)
            {
                SquadMembership guest =
                    SquadMembership.CreateGuest(squad.Id, $"Guest {i + 1}", skillTier: null, Anchor).Value!;
                if (i >= availableGuests)
                {
                    guest.Deactivate();
                }

                squadStore.AddCommittedMembership(guest);
                marked.SubmitAvailability(guest.Id, new[] { ConfirmedDay }, Anchor.AddMinutes(i + 1));
            }

            // The match drafted in GatheringAvailability with the single candidate day, as loaded.
            Match match = Match.CreateDraft(
                matchId,
                squad.Id,
                Location,
                new[] { ConfirmedDay },
                Anchor).Value!;

            var unitOfWork = new ConfirmFakeUnitOfWork(throwOnSave);
            var publisher = new CapturingConfirmPublisher(mode, unitOfWork);

            var handler = new ConfirmMatchHandler(
                new ConfirmFakeMatchRepository(match),
                new ConfirmFakeAvailabilityRepository(marked.AvailabilityResponses.ToList()),
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
