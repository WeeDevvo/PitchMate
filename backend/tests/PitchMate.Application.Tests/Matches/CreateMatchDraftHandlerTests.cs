using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Tests.Squads;
using PitchMate.Domain.Squads;
using MatchResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.CreateMatchDraftResult>;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="CreateMatchDraftHandler"/>'s notification wiring and its post-commit,
/// best-effort isolation boundary (task 14.2, Requirements 3.1, 3.2, 3.3, 13.1). They drive the real
/// handler against in-memory fakes — the match store/unit-of-work model the commit boundary, the
/// committed squad fakes supply the acting owner and squad name, and a capturing publisher observes
/// every publish attempt — with a controllable clock so candidate-day future-dating is deterministic.
/// <para>
/// The handler resolves the acting membership via the squad fakes, so the acting owner is seeded as a
/// committed membership whose squad id matches the drafted match's squad. Each test asserts one facet:
/// exactly one <c>MatchDrafted</c> after a committed create; nothing published when the create rolls
/// back; a failing or throwing publish isolated and still reported as success; and a client-supplied
/// GUID v7 id retained (with a generated v7 id when none is supplied).
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class CreateMatchDraftHandlerTests
{
    /// <summary>A fixed UTC anchor the fake clock reads from; candidate days sit well after it.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>A single, valid, strictly-future candidate day relative to <see cref="Anchor"/>.</summary>
    private static readonly IReadOnlyList<DateTimeOffset> CandidateDays = new[] { Anchor.AddDays(7) };

    private const string Location = "Hackney Marshes, Pitch 12";

    // Requirement 3.1: exactly one MatchDrafted event is raised, after the create has committed.
    [Fact]
    public async Task SuccessfulCommit_PublishesExactlyOneMatchDraftedAfterCommit()
    {
        Harness h = Harness.WithActiveOwner(DraftPublisherMode.Success);

        MatchResult result = await h.Handler.HandleAsync(
            new CreateMatchDraftCommand(h.OwnerUserId, h.SquadId, Location, CandidateDays),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, h.MatchStore.SaveCallCount);
        Assert.True(h.MatchStore.IsCommitted(result.Value!.MatchId));

        CapturingDraftPublisher.PublishCall call = Assert.Single(h.Publisher.Calls);
        Assert.Equal(NotificationType.MatchDrafted, call.Type);
        Assert.Equal(h.SquadId, call.SquadId);
        // It is a squad broadcast, so it names no directed targets, and it ran only after the commit.
        Assert.Empty(call.DirectedTargetMembershipIds);
        Assert.True(call.MatchWasCommittedAtPublish);
    }

    // Requirement 3.2: a rolled-back (uncommitted) create publishes no MatchDrafted event.
    [Fact]
    public async Task RolledBackCommit_PublishesNothing()
    {
        Harness h = Harness.WithActiveOwner(DraftPublisherMode.Success, throwOnSave: true);

        // The commit throws and the handler does not swallow it, so the failure surfaces to the caller.
        await Assert.ThrowsAsync<InvalidOperationException>(() => h.Handler.HandleAsync(
            new CreateMatchDraftCommand(h.OwnerUserId, h.SquadId, Location, CandidateDays),
            CancellationToken.None));

        Assert.Equal(1, h.MatchStore.SaveCallCount);
        Assert.Empty(h.MatchStore.Matches);
        Assert.Empty(h.Publisher.Calls);
    }

    // Requirement 3.3: a publish that returns a failure result is isolated; the create still succeeds
    // and the committed draft is retained.
    [Fact]
    public async Task PublishFailureResult_IsIsolatedAndReportedAsSuccess()
    {
        Harness h = Harness.WithActiveOwner(DraftPublisherMode.FailureResult);

        MatchResult result = await h.Handler.HandleAsync(
            new CreateMatchDraftCommand(h.OwnerUserId, h.SquadId, Location, CandidateDays),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(h.MatchStore.IsCommitted(result.Value!.MatchId));
        Assert.Single(h.Publisher.Calls);
    }

    // Requirement 3.3: a publish that throws is caught; the create still succeeds and the committed
    // draft is retained.
    [Fact]
    public async Task PublishThrows_IsIsolatedAndReportedAsSuccess()
    {
        Harness h = Harness.WithActiveOwner(DraftPublisherMode.Throws);

        MatchResult result = await h.Handler.HandleAsync(
            new CreateMatchDraftCommand(h.OwnerUserId, h.SquadId, Location, CandidateDays),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(h.MatchStore.IsCommitted(result.Value!.MatchId));
        Assert.Single(h.Publisher.Calls);
    }

    // Requirement 13.1: a non-empty client-supplied id is retained as the created match's identity.
    [Fact]
    public async Task ClientSuppliedId_IsRetained()
    {
        Harness h = Harness.WithActiveOwner(DraftPublisherMode.Success);
        Guid clientId = Guid.CreateVersion7();

        MatchResult result = await h.Handler.HandleAsync(
            new CreateMatchDraftCommand(h.OwnerUserId, h.SquadId, Location, CandidateDays, clientId),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(clientId, result.Value!.MatchId);
        Assert.NotNull(h.MatchStore.FindById(clientId));
    }

    // Requirement 13.1: when no id is supplied, a fresh GUID v7 identity is generated.
    [Fact]
    public async Task NoClientId_GeneratesGuidV7()
    {
        Harness h = Harness.WithActiveOwner(DraftPublisherMode.Success);

        MatchResult result = await h.Handler.HandleAsync(
            new CreateMatchDraftCommand(h.OwnerUserId, h.SquadId, Location, CandidateDays, MatchId: null),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotEqual(Guid.Empty, result.Value!.MatchId);
        Assert.Equal(7, result.Value!.MatchId.Version);
        Assert.True(h.MatchStore.IsCommitted(result.Value!.MatchId));
    }

    /// <summary>
    /// Wires a <see cref="CreateMatchDraftHandler"/> to in-memory fakes: a committed squad and its
    /// active owner (so the organiser gate passes and the squad name renders), a match store/unit of
    /// work modelling the commit boundary, a capturing publisher in the requested mode, and a fixed
    /// clock the candidate days sit after.
    /// </summary>
    private sealed class Harness
    {
        public required CreateMatchDraftHandler Handler { get; init; }
        public required MatchStore MatchStore { get; init; }
        public required CapturingDraftPublisher Publisher { get; init; }
        public required Guid SquadId { get; init; }
        public required Guid OwnerUserId { get; init; }

        public static Harness WithActiveOwner(DraftPublisherMode mode, bool throwOnSave = false)
        {
            var squadStore = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            squadStore.AddCommittedSquad(squad);

            Guid ownerUserId = Guid.NewGuid();
            squadStore.AddCommittedMembership(
                SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

            var matchStore = new MatchStore();
            var publisher = new CapturingDraftPublisher(mode, matchStore);
            var clock = new SquadFakeClock(Anchor);

            var handler = new CreateMatchDraftHandler(
                new FakeMatchRepository(matchStore),
                new FakeSquadMembershipRepository(squadStore),
                new FakeSquadRepository(squadStore),
                new FakeMatchUnitOfWork(matchStore, throwOnSave),
                clock,
                publisher,
                NullLogger<CreateMatchDraftHandler>.Instance);

            return new Harness
            {
                Handler = handler,
                MatchStore = matchStore,
                Publisher = publisher,
                SquadId = squad.Id,
                OwnerUserId = ownerUserId,
            };
        }
    }
}
