using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for the response contract <see cref="SubmitAvailabilityResponseHandler"/> reports on a
/// successful submission (Requirements 8.1, 8.2, 8.3, 8.4, 9.1). They pin the four values
/// <see cref="SubmitAvailabilityResult"/> carries — the match, the responding membership, the
/// submission instant, and the marked days as bare UTC instants — and that the record is not a
/// persistence entity, so the <c>BaseEntity</c> audit and soft-delete members the operation used to
/// put on the wire can no longer appear.
/// <para>
/// The handler is driven against hand-written in-memory fakes with no database, per the
/// Application-layer testing strategy. The gate itself is not re-tested here: Property 6 in
/// <see cref="AvailabilityAuthorisationPropertyTests"/> owns who may submit, and these tests use a
/// single active registered member so the projection is what is under test.
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class SubmitAvailabilityResponseHandlerTests
{
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// The success response reports the match, the responding membership, the clock's submission
    /// instant, and exactly the marked days — each as the bare UTC instant the aggregate holds, so a
    /// day supplied with a non-UTC offset is reported as the same moment in UTC (Requirements 8.1,
    /// 8.4, 9.1, 9.2, 9.4).
    /// </summary>
    [Fact]
    public async Task SuccessfulSubmissionReportsTheMatchMembershipInstantAndMarkedDays()
    {
        World world = World.Create();

        // The second day is supplied in a non-UTC offset: equal by instant to the candidate day, so it
        // is accepted, and reported as the UTC representation of that instant.
        DateTimeOffset offsetDay = world.CandidateDays[1].ToOffset(TimeSpan.FromHours(5));

        Result<SubmitAvailabilityResult> result = await world.Handler.HandleAsync(
            new SubmitAvailabilityResponseCommand(
                world.ActingUserId, world.SquadId, world.MatchId, [world.CandidateDays[0], offsetDay]),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        SubmitAvailabilityResult submitted = result.Value!;

        Assert.Equal(world.MatchId, submitted.MatchId);
        Assert.Equal(world.ActingMembershipId, submitted.SquadMembershipId);
        Assert.Equal(Now, submitted.SubmittedAt);
        Assert.Equal(
            new[] { world.CandidateDays[0], world.CandidateDays[1] },
            submitted.MarkedDays);
        Assert.All(submitted.MarkedDays, day => Assert.Equal(TimeSpan.Zero, day.Offset));
    }

    /// <summary>
    /// A submission marking none of the candidate days succeeds and reports an empty — not absent —
    /// collection, keeping the stored empty-subset response distinct from having no stored response
    /// (Requirements 8.1, 8.4).
    /// </summary>
    [Fact]
    public async Task EmptySubsetSubmissionReportsAnEmptyMarkedDayCollection()
    {
        World world = World.Create();

        Result<SubmitAvailabilityResult> result = await world.Handler.HandleAsync(
            new SubmitAvailabilityResponseCommand(world.ActingUserId, world.SquadId, world.MatchId, []),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value!.MarkedDays);
        Assert.Empty(result.Value!.MarkedDays);
    }

    /// <summary>
    /// When the submission replaces a response already stored for the membership, the response reports
    /// the replacing submission's instant and marked days and no instant or marked day of the replaced
    /// one (Requirement 8.2).
    /// </summary>
    [Fact]
    public async Task ReplacingSubmissionReportsOnlyTheReplacingSubmissionsValues()
    {
        World world = World.Create();

        Result<SubmitAvailabilityResult> first = await world.Handler.HandleAsync(
            new SubmitAvailabilityResponseCommand(
                world.ActingUserId, world.SquadId, world.MatchId, [world.CandidateDays[0]]),
            CancellationToken.None);
        Assert.True(first.IsSuccess);

        world.Clock.Advance(TimeSpan.FromMinutes(30));

        Result<SubmitAvailabilityResult> second = await world.Handler.HandleAsync(
            new SubmitAvailabilityResponseCommand(
                world.ActingUserId, world.SquadId, world.MatchId, [world.CandidateDays[2]]),
            CancellationToken.None);

        Assert.True(second.IsSuccess);
        SubmitAvailabilityResult replacing = second.Value!;

        Assert.Equal(Now.AddMinutes(30), replacing.SubmittedAt);
        Assert.NotEqual(first.Value!.SubmittedAt, replacing.SubmittedAt);
        Assert.Equal(new[] { world.CandidateDays[2] }, replacing.MarkedDays);
        Assert.DoesNotContain(world.CandidateDays[0], replacing.MarkedDays);

        // The membership still retains exactly one stored response — the replacing one.
        Assert.Equal(1, world.Availability.StoredResponseCount);
    }

    /// <summary>
    /// The declared contract is not a persistence entity, so none of the <c>BaseEntity</c>-declared
    /// members the operation used to report — the entity identity, the audit instants and actors, and
    /// the soft-delete flag and instant — can cross the wire (Requirements 8.1, 8.3).
    /// </summary>
    [Fact]
    public void TheResponseContractDerivesFromNoPersistenceBaseEntity()
    {
        Assert.False(typeof(BaseEntity).IsAssignableFrom(typeof(SubmitAvailabilityResult)));
    }

    /// <summary>
    /// Assembles the handler over in-memory fakes with a match gathering availability and a single
    /// active registered member acting, so the authorisation gate always admits and the projection is
    /// what the tests observe.
    /// </summary>
    private sealed class World
    {
        private World(
            SubmitAvailabilityResponseHandler handler,
            RecordingAvailabilityRepository availability,
            FakeTimeProvider clock,
            Guid actingUserId,
            Guid actingMembershipId,
            Guid squadId,
            Guid matchId,
            IReadOnlyList<DateTimeOffset> candidateDays)
        {
            Handler = handler;
            Availability = availability;
            Clock = clock;
            ActingUserId = actingUserId;
            ActingMembershipId = actingMembershipId;
            SquadId = squadId;
            MatchId = matchId;
            CandidateDays = candidateDays;
        }

        public SubmitAvailabilityResponseHandler Handler { get; }

        public RecordingAvailabilityRepository Availability { get; }

        public FakeTimeProvider Clock { get; }

        public Guid ActingUserId { get; }

        public Guid ActingMembershipId { get; }

        /// <summary>The match's own squad, which the command's path squad must equal.</summary>
        public Guid SquadId { get; }

        public Guid MatchId { get; }

        /// <summary>The match's candidate days, already normalised to UTC by the aggregate.</summary>
        public IReadOnlyList<DateTimeOffset> CandidateDays { get; }

        public static World Create()
        {
            var squadId = Guid.NewGuid();
            var actingUserId = Guid.NewGuid();

            List<DateTimeOffset> candidateDays =
            [
                Now.AddDays(1),
                Now.AddDays(2),
                Now.AddDays(3),
            ];

            Match match = Match.CreateDraft(
                Guid.CreateVersion7(), squadId, "Recreation Ground", candidateDays, Now).Value!;

            SquadMembership acting = SquadMembership.CreateRegistered(squadId, actingUserId, "Member").Value!;

            var availability = new RecordingAvailabilityRepository();
            var clock = new FakeTimeProvider(Now);
            var handler = new SubmitAvailabilityResponseHandler(
                new ConcealmentMatchRepository(match),
                new ConcealmentMembershipRepository(acting),
                availability,
                new CommittingUnitOfWork(availability),
                clock);

            return new World(
                handler,
                availability,
                clock,
                actingUserId,
                acting.Id,
                squadId,
                match.Id,
                [.. match.CandidateDays.Select(day => day.Instant)]);
        }
    }
}
