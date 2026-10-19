using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using RatingError = PitchMate.Domain.Rating.RatingError;
using RatingErrorCode = PitchMate.Domain.Rating.RatingErrorCode;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using SquadRole = PitchMate.Domain.Squads.SquadRole;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="GetWorkingTeamsHandler"/> (match-read-models task 11.4) over hand-written
/// fakes — no connection and no <c>DbContext</c>.
/// <para>
/// The Organiser_Gate admits only an active, non-guest owner or admin; every other caller, and a match
/// the source cannot find, gets the identical uniform failure. The engine is asked to predict at most
/// once, and only for at least two non-empty rosters; an unrated member is seeded in memory, which the
/// handler cannot persist because it holds no rating repository at all. A prediction failure returns
/// <see cref="MatchErrorCode.ValidationFailed"/> and no partial view.
/// </para>
/// <para>
/// <b>Validates: Requirements 4.10, 4.16, 4.17, 4.19, 5.2, 13.1.</b>
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class GetWorkingTeamsHandlerTests
{
    // ---------------------------------------------------------------------------------------------
    // Success path
    // ---------------------------------------------------------------------------------------------

    [Theory]
    [InlineData(SquadRole.Owner)]
    [InlineData(SquadRole.Admin)]
    public async Task Organiser_ReceivesTheTeamsThePredictionAndTheUnassigned(SquadRole role)
    {
        Fixture f = Fixture.WithOrganiser(role, TwoTeams(out Guid unassigned));
        var engine = new SpyRatingEngine();

        Result<WorkingTeamsView> result = await f.HandlerWith(engine).HandleAsync(f.Command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        WorkingTeamsView view = result.Value!;
        Assert.Equal(f.Projection.Teams, view.Teams);
        Assert.Equal([unassigned], view.UnassignedParticipants);
        Assert.NotNull(view.Prediction);
        Assert.Equal([0.6, 0.4], view.Prediction!.WinProbabilities);
        Assert.Equal(0.1, view.Prediction.DrawProbability);
        Assert.Single(engine.PredictCalls);
    }

    [Fact]
    public async Task UnratedMembers_AreSeededInMemoryFromTheirTier_AndRatedMembersUseTheirPersistedRating()
    {
        WorkingTeamsProjection projection = TwoTeams(out _);
        Guid rated = projection.Teams[0].Roster[0].SquadMembershipId;
        Guid tiered = projection.Teams[1].Roster[0].SquadMembershipId;
        var persisted = new PlayerRating(31, 2);

        projection = projection with
        {
            RatingsByMembershipId = new Dictionary<Guid, PlayerRating> { [rated] = persisted },
            SkillTiersByMembershipId = new Dictionary<Guid, SkillTier?> { [tiered] = SkillTier.Average },
        };

        Fixture f = Fixture.WithOrganiser(SquadRole.Owner, projection);
        var engine = new SpyRatingEngine();

        await f.HandlerWith(engine).HandleAsync(f.Command, CancellationToken.None);

        IReadOnlyList<PitchMate.Domain.Rating.TeamRoster> rosters = Assert.Single(engine.PredictCalls);
        Assert.Equal(persisted, rosters[0].Players[0]);
        Assert.Equal(SpyRatingEngine.SeedFor(SkillTier.Average), rosters[1].Players[0]);
        Assert.Contains(SkillTier.Average, engine.SeededTiers);
    }

    [Fact]
    public void TheHandlerCannotPersistARating_ItHoldsNoRatingRepository()
    {
        Assert.All(
            typeof(GetWorkingTeamsHandler).GetConstructors().SelectMany(static ctor => ctor.GetParameters()),
            static parameter => Assert.NotEqual(typeof(IMembershipRatingRepository), parameter.ParameterType));
    }

    [Theory]
    [MemberData(nameof(ArrangementsTheEngineRejects))]
    public async Task ArrangementTheEngineRejects_ReportsTheTeamsWithNoPredictionAndNeverCallsPredict(int teamCount, bool withEmptyRoster)
    {
        Fixture f = Fixture.WithOrganiser(SquadRole.Owner, Teams(teamCount, withEmptyRoster));
        var engine = new SpyRatingEngine();

        Result<WorkingTeamsView> result = await f.HandlerWith(engine).HandleAsync(f.Command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(teamCount, result.Value!.Teams.Count);
        Assert.Null(result.Value.Prediction);
        Assert.Empty(engine.PredictCalls);
    }

    public static TheoryData<int, bool> ArrangementsTheEngineRejects() => new()
    {
        { 0, false },
        { 1, false },
        { 2, true },
        { 3, true },
    };

    [Fact]
    public async Task PredictionFailure_ReturnsValidationFailedAndNoView()
    {
        Fixture f = Fixture.WithOrganiser(SquadRole.Owner, TwoTeams(out _));
        var engine = new SpyRatingEngine(
            PitchMate.Domain.Rating.Result<MatchPrediction>.Fail(new RatingError(RatingErrorCode.NonFiniteValue, "boom")));

        Result<WorkingTeamsView> result = await f.HandlerWith(engine).HandleAsync(f.Command, CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.Equal(MatchErrorCode.ValidationFailed, result.Error!.Code);
        Assert.Single(engine.PredictCalls);
    }

    // ---------------------------------------------------------------------------------------------
    // Refusal paths
    // ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task EveryRefusalCause_ProducesTheIdenticalUniformFailure_WithoutPredicting()
    {
        Fixture[] refused =
        [
            Fixture.WithNoMembership(),
            Fixture.WithInactiveOrganiser(),
            Fixture.WithOrganiserOfAnotherSquad(),
            Fixture.WithMatchNotFound(),
            Fixture.WithPlainMember(),
            Fixture.WithGuest(),
        ];

        foreach (Fixture f in refused)
        {
            var engine = new SpyRatingEngine();
            Result<WorkingTeamsView> result = await f.HandlerWith(engine).HandleAsync(f.Command, CancellationToken.None);

            Assert.False(result.IsSuccess);
            Assert.Null(result.Value);
            Assert.Equal(MatchErrorCode.Unauthorized, result.Error!.Code);
            Assert.Equal("The requested action is not permitted.", result.Error.Message);
            Assert.Empty(engine.PredictCalls);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Projections and fixture
    // ---------------------------------------------------------------------------------------------

    private static WorkingTeamsProjection TwoTeams(out Guid unassigned)
    {
        WorkingTeamsProjection projection = Teams(2, withEmptyRoster: false);
        unassigned = Guid.NewGuid();
        return projection with { ParticipantIds = [.. projection.ParticipantIds, unassigned] };
    }

    private static WorkingTeamsProjection Teams(int count, bool withEmptyRoster)
    {
        List<WorkingTeamView> teams =
        [
            .. Enumerable.Range(0, count).Select(index => new WorkingTeamView(
                Guid.CreateVersion7(),
                $"Team {index}",
                BibFlag: index == 1,
                withEmptyRoster && index == count - 1
                    ? []
                    : [new RosterEntry(Guid.NewGuid(), $"P{index}a"), new RosterEntry(Guid.NewGuid(), $"P{index}b")])),
        ];

        return new WorkingTeamsProjection(
            Guid.CreateVersion7(),
            Guid.NewGuid(),
            teams,
            [.. teams.SelectMany(static team => team.Roster).Select(static entry => entry.SquadMembershipId)],
            new Dictionary<Guid, PlayerRating>(),
            new Dictionary<Guid, SkillTier?>());
    }

    private sealed class Fixture
    {
        private readonly WorkingTeamsProjection? _found;
        private readonly PitchMate.Application.Squads.Abstractions.ISquadMembershipRepository _memberships;

        private Fixture(WorkingTeamsProjection projection, bool found, Guid userId, PitchMate.Application.Squads.Abstractions.ISquadMembershipRepository memberships)
        {
            Projection = projection;
            _found = found ? projection : null;
            _memberships = memberships;
            Command = new GetWorkingTeamsCommand(userId, projection.MatchId);
        }

        public WorkingTeamsProjection Projection { get; }

        public GetWorkingTeamsCommand Command { get; }

        public GetWorkingTeamsHandler HandlerWith(SpyRatingEngine engine) =>
            new(new RecordingWorkingTeamsSource(_found), _memberships, engine);

        public static Fixture WithOrganiser(SquadRole role, WorkingTeamsProjection projection)
        {
            SquadMembership acting = role == SquadRole.Owner
                ? SquadMembership.CreateOwner(projection.SquadId, Guid.NewGuid(), "Owner").Value!
                : Admin(projection.SquadId);
            return new Fixture(projection, true, acting.UserId!.Value, new ConcealmentMembershipRepository(acting));
        }

        public static Fixture WithPlainMember()
        {
            WorkingTeamsProjection projection = TwoTeams(out _);
            SquadMembership acting = SquadMembership.CreateRegistered(projection.SquadId, Guid.NewGuid(), "Member").Value!;
            return new Fixture(projection, true, acting.UserId!.Value, new ConcealmentMembershipRepository(acting));
        }

        /// <summary>
        /// An active guest membership resolved as the acting membership. A guest has no user, so the fake
        /// returns it for any lookup — the gate itself must refuse it.
        /// </summary>
        public static Fixture WithGuest()
        {
            WorkingTeamsProjection projection = TwoTeams(out _);
            SquadMembership guest = SquadMembership.CreateGuest(projection.SquadId, "Guest", null, DateTimeOffset.UnixEpoch).Value!;
            return new Fixture(projection, true, Guid.NewGuid(), new AnyLookupMembershipRepository(guest));
        }

        public static Fixture WithNoMembership() =>
            new(TwoTeams(out _), true, Guid.NewGuid(), new ConcealmentMembershipRepository());

        public static Fixture WithInactiveOrganiser()
        {
            WorkingTeamsProjection projection = TwoTeams(out _);
            SquadMembership acting = Admin(projection.SquadId);
            acting.Deactivate();
            return new Fixture(projection, true, acting.UserId!.Value, new ConcealmentMembershipRepository(acting));
        }

        public static Fixture WithOrganiserOfAnotherSquad()
        {
            SquadMembership elsewhere = SquadMembership.CreateOwner(Guid.NewGuid(), Guid.NewGuid(), "Owner").Value!;
            return new Fixture(TwoTeams(out _), true, elsewhere.UserId!.Value, new ConcealmentMembershipRepository(elsewhere));
        }

        public static Fixture WithMatchNotFound()
        {
            WorkingTeamsProjection projection = TwoTeams(out _);
            SquadMembership acting = SquadMembership.CreateOwner(projection.SquadId, Guid.NewGuid(), "Owner").Value!;
            return new Fixture(projection, false, acting.UserId!.Value, new ConcealmentMembershipRepository(acting));
        }

        private static SquadMembership Admin(Guid squadId)
        {
            SquadMembership admin = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Admin").Value!;
            Assert.True(admin.PromoteToAdmin().IsSuccess);
            return admin;
        }
    }
}
