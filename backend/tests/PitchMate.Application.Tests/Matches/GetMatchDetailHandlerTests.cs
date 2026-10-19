using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="GetMatchDetailHandler"/> (match-read-models task 10.4) over hand-written
/// fakes — no connection and no <c>DbContext</c>.
/// <para>
/// The success path composes the detail from the source's projection, the caller's own stored response
/// and the effective threshold seam, in every one of the six lifecycle states. Every refusal cause — no
/// acting membership, an inactive one, one in a different squad, a match the source cannot find, a
/// squad that is not visible — returns the identical uniform failure.
/// </para>
/// <para>
/// <b>Validates: Requirements 2.8, 3.4, 3.5, 3.6, 13.1.</b>
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class GetMatchDetailHandlerTests
{
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // ---------------------------------------------------------------------------------------------
    // Success path
    // ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task ActiveMember_ReceivesTheProjectionComposedWithTheirAvailabilityAndTheThreshold()
    {
        Fixture f = Fixture.WithActiveMember(MatchState.GatheringAvailability);
        AvailabilityResponse response = f.Respond([Now.AddDays(8)]);
        var handler = f.HandlerWith(new StoredResponseAvailabilityRepository(response));

        Result<MatchDetail> result = await handler.HandleAsync(f.Command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        MatchDetail detail = result.Value!;
        Assert.Equal(f.Projection.MatchId, detail.MatchId);
        Assert.Equal(f.Projection.SquadId, detail.SquadId);
        Assert.Equal(f.Projection.Location, detail.Location);
        Assert.Equal(f.Projection.CandidateDays, detail.CandidateDays);
        Assert.Equal(f.Projection.Participants, detail.Participants);
        Assert.Equal(f.Projection.Participants.Count, detail.ParticipantCount);
        Assert.True(detail.CallerAvailability.HasStoredResponse);
        Assert.Equal([Now.AddDays(8)], detail.CallerAvailability.MarkedDays);
    }

    [Theory]
    [InlineData(MatchState.GatheringAvailability)]
    [InlineData(MatchState.Confirmed)]
    [InlineData(MatchState.TeamsRolled)]
    [InlineData(MatchState.InProgress)]
    [InlineData(MatchState.Completed)]
    [InlineData(MatchState.Cancelled)]
    public async Task EveryLifecycleState_Succeeds(MatchState state)
    {
        Fixture f = Fixture.WithActiveMember(state);

        Result<MatchDetail> result = await f.HandlerWith(new StoredResponseAvailabilityRepository())
            .HandleAsync(f.Command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(state, result.Value!.State);
    }

    [Fact]
    public async Task StoredResponseMarkingNoDay_IsTrueAndEmpty()
    {
        Fixture f = Fixture.WithActiveMember(MatchState.GatheringAvailability);
        AvailabilityResponse response = f.Respond([]);

        Result<MatchDetail> result = await f.HandlerWith(new StoredResponseAvailabilityRepository(response))
            .HandleAsync(f.Command, CancellationToken.None);

        Assert.True(result.Value!.CallerAvailability.HasStoredResponse);
        Assert.Empty(result.Value.CallerAvailability.MarkedDays);
    }

    [Fact]
    public async Task NoStoredResponse_IsFalseAndEmpty()
    {
        Fixture f = Fixture.WithActiveMember(MatchState.GatheringAvailability);

        Result<MatchDetail> result = await f.HandlerWith(new StoredResponseAvailabilityRepository())
            .HandleAsync(f.Command, CancellationToken.None);

        Assert.False(result.Value!.CallerAvailability.HasStoredResponse);
        Assert.Empty(result.Value.CallerAvailability.MarkedDays);
    }

    [Fact]
    public async Task CallersAvailability_IsReadForExactlyTheGatedMembershipAndNoOther()
    {
        Fixture f = Fixture.WithActiveMember(MatchState.GatheringAvailability);
        AvailabilityResponse someoneElse = f.RespondAs(Guid.NewGuid(), [Now.AddDays(7)]);
        var availability = new StoredResponseAvailabilityRepository(someoneElse);

        Result<MatchDetail> result = await f.HandlerWith(availability).HandleAsync(f.Command, CancellationToken.None);

        Assert.False(result.Value!.CallerAvailability.HasStoredResponse);
        (Guid matchId, Guid membershipId) = Assert.Single(availability.Lookups);
        Assert.Equal(f.Projection.MatchId, matchId);
        Assert.Equal(f.Acting.Id, membershipId);
    }

    [Fact]
    public async Task EffectiveThreshold_IsTheConfirmationPathsDefault()
    {
        Fixture f = Fixture.WithActiveMember(MatchState.GatheringAvailability);

        Result<MatchDetail> result = await f.HandlerWith(new StoredResponseAvailabilityRepository())
            .HandleAsync(f.Command, CancellationToken.None);

        Assert.Equal(ConfirmMatchHandler.DefaultMinimumPlayerThreshold, result.Value!.EffectiveMinimumPlayerThreshold);
    }

    // ---------------------------------------------------------------------------------------------
    // Refusal paths
    // ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task EveryRefusalCause_ProducesTheIdenticalUniformFailure()
    {
        MatchError[] errors =
        [
            await RefuseAsync(Fixture.WithNoMembership()),
            await RefuseAsync(Fixture.WithInactiveMember()),
            await RefuseAsync(Fixture.WithMembershipOfAnotherSquad()),
            await RefuseAsync(Fixture.WithMatchNotFound()),
        ];

        Assert.All(errors, error =>
        {
            Assert.Equal(MatchErrorCode.Unauthorized, error.Code);
            Assert.Equal(errors[0].Message, error.Message);
        });
    }

    [Fact]
    public async Task MatchNotFoundOrSquadNotVisible_RefusedWithoutReadingAvailability()
    {
        Fixture f = Fixture.WithMatchNotFound();
        var availability = new StoredResponseAvailabilityRepository();

        Result<MatchDetail> result = await f.HandlerWith(availability).HandleAsync(f.Command, CancellationToken.None);

        AssertUniformAuthorisationFailure(result);
        Assert.Empty(availability.Lookups);
    }

    [Fact]
    public async Task RefusedMembership_ReadsNoAvailability()
    {
        Fixture f = Fixture.WithInactiveMember();
        var availability = new StoredResponseAvailabilityRepository();

        Result<MatchDetail> result = await f.HandlerWith(availability).HandleAsync(f.Command, CancellationToken.None);

        AssertUniformAuthorisationFailure(result);
        Assert.Empty(availability.Lookups);
    }

    // ---------------------------------------------------------------------------------------------
    // Shared assertions and fixture
    // ---------------------------------------------------------------------------------------------

    private static async Task<MatchError> RefuseAsync(Fixture f)
    {
        Result<MatchDetail> result = await f.HandlerWith(new StoredResponseAvailabilityRepository())
            .HandleAsync(f.Command, CancellationToken.None);

        AssertUniformAuthorisationFailure(result);
        return result.Error!;
    }

    private static void AssertUniformAuthorisationFailure(Result<MatchDetail> result)
    {
        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.Equal(MatchErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal("The requested action is not permitted.", result.Error.Message);
    }

    private sealed class Fixture
    {
        private readonly MatchDetailProjection? _projection;
        private readonly ConcealmentMembershipRepository _memberships;

        private Fixture(
            MatchDetailProjection projection,
            bool sourceFindsMatch,
            SquadMembership acting,
            ConcealmentMembershipRepository memberships)
        {
            Projection = projection;
            _projection = sourceFindsMatch ? projection : null;
            Acting = acting;
            _memberships = memberships;
            Command = new GetMatchDetailCommand(acting.UserId!.Value, projection.MatchId);
        }

        public MatchDetailProjection Projection { get; }

        public SquadMembership Acting { get; }

        public GetMatchDetailCommand Command { get; }

        public GetMatchDetailHandler HandlerWith(IAvailabilityRepository availability) =>
            new(new RecordingMatchDetailSource(_projection), _memberships, availability);

        /// <summary>A stored response by the acting membership, built through the real aggregate.</summary>
        public AvailabilityResponse Respond(IReadOnlyList<DateTimeOffset> markedDays) =>
            RespondAs(Acting.Id, markedDays);

        public AvailabilityResponse RespondAs(Guid membershipId, IReadOnlyList<DateTimeOffset> markedDays)
        {
            Match draft = Match.CreateDraft(
                Projection.MatchId, Projection.SquadId, Projection.Location, [.. Projection.CandidateDays], Now).Value!;

            return draft.SubmitAvailability(membershipId, markedDays, Now).Value!;
        }

        public static Fixture WithActiveMember(MatchState state)
        {
            MatchDetailProjection projection = ProjectionIn(Guid.NewGuid(), state);
            SquadMembership acting = Member(projection.SquadId);
            return new Fixture(projection, true, acting, new ConcealmentMembershipRepository(acting));
        }

        public static Fixture WithNoMembership()
        {
            MatchDetailProjection projection = ProjectionIn(Guid.NewGuid(), MatchState.Confirmed);
            return new Fixture(projection, true, Member(projection.SquadId), new ConcealmentMembershipRepository());
        }

        public static Fixture WithInactiveMember()
        {
            MatchDetailProjection projection = ProjectionIn(Guid.NewGuid(), MatchState.Confirmed);
            SquadMembership acting = Member(projection.SquadId);
            acting.Deactivate();
            return new Fixture(projection, true, acting, new ConcealmentMembershipRepository(acting));
        }

        public static Fixture WithMembershipOfAnotherSquad()
        {
            MatchDetailProjection projection = ProjectionIn(Guid.NewGuid(), MatchState.Confirmed);
            SquadMembership elsewhere = Member(Guid.NewGuid());
            return new Fixture(projection, true, elsewhere, new ConcealmentMembershipRepository(elsewhere));
        }

        /// <summary>The source answers null: the match is absent, soft-deleted, or its squad is not visible.</summary>
        public static Fixture WithMatchNotFound()
        {
            MatchDetailProjection projection = ProjectionIn(Guid.NewGuid(), MatchState.Confirmed);
            SquadMembership acting = Member(projection.SquadId);
            return new Fixture(projection, false, acting, new ConcealmentMembershipRepository(acting));
        }

        private static SquadMembership Member(Guid squadId) =>
            SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Member").Value!;

        private static MatchDetailProjection ProjectionIn(Guid squadId, MatchState state) =>
            new(
                MatchId: Guid.CreateVersion7(),
                SquadId: squadId,
                State: state,
                Location: "Hackney Marshes, Pitch 12",
                CandidateDays: [Now.AddDays(7), Now.AddDays(8)],
                ConfirmedDay: state == MatchState.GatheringAvailability ? null : Now.AddDays(7),
                Participants:
                [
                    new ParticipantView(Guid.NewGuid(), "Alex", IsGuest: false, RosterPosition: 0),
                    new ParticipantView(Guid.NewGuid(), "Sam (guest)", IsGuest: true, RosterPosition: 2),
                ],
                RecordedResult: null,
                CompletedAt: state == MatchState.Completed ? Now.AddDays(8) : null);
    }
}
