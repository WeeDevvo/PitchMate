using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
// PitchMate.Domain.Matches, PitchMate.Domain.Squads, and PitchMate.Domain.LiveTracking each define a
// Result/Result<T> triad. Import only PitchMate.Domain.LiveTracking above so the unqualified
// Result<GetRunningScoreResult> the handler returns binds to the live-tracking triad, and pull in the
// specific match-lifecycle / squad types by alias (mirroring the handler under test).
using Match = PitchMate.Domain.Matches.Match;
using MatchState = PitchMate.Domain.Matches.MatchState;
using ProposedTeam = PitchMate.Domain.Matches.ProposedTeam;
using TeamScore = PitchMate.Domain.Matches.TeamScore;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadFeature = PitchMate.Domain.Squads.SquadFeature;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Example-based tests for <see cref="GetRunningScoreHandler"/> covering the three behaviours of task
/// 10.2: an active squad member reads the projected running score (Requirement 6.4); a non-member,
/// inactive membership, or a request for a match that cannot be found all receive the uniform,
/// existence-concealing <see cref="LiveTrackingErrorCode.Unauthorized"/> failure that discloses no
/// match data (Requirement 11.3, 11.4); and a match with no effective <c>GoalScored</c> events reports
/// each working team's running score as 0 (Requirement 6.4).
/// <para>
/// Each test drives the real handler over the shared hand-written in-memory fakes
/// (<see cref="SingleMatchRepository"/>, <see cref="ConfiguredMembershipRepository"/>,
/// <see cref="InMemoryMatchEventRepository"/>, <see cref="MutableCurrentUserAccessor"/>) via the
/// <see cref="GetRunningScoreWorld"/> harness. No database and no mocking framework, per the
/// Application-layer testing strategy.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class GetRunningScoreHandlerTests
{
    // ---- Member success (Requirement 6.4) ---------------------------------------------------------

    [Fact]
    public void AnActiveMemberReadsTheProjectedRunningScoreForTheMatch()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();
        // Seed an effective log of Team A 2, Team B 1.
        world.SeedGoal(world.TeamAId, 5);
        world.SeedGoal(world.TeamAId, 41);
        world.SeedGoal(world.TeamBId, 23);

        Result<GetRunningScoreResult> result = world.Read(world.ActiveMemberUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(world.Match.Id, result.Value!.MatchId);
        Assert.Equal(world.Match.Teams.Count, result.Value!.TeamScores.Count);
        Assert.Equal(2, ScoreFor(result.Value!.TeamScores, world.TeamAId));
        Assert.Equal(1, ScoreFor(result.Value!.TeamScores, world.TeamBId));
    }

    [Fact]
    public void TheOwnerReadsTheProjectedRunningScore()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();
        world.SeedGoal(world.TeamBId, 12);

        Result<GetRunningScoreResult> result = world.Read(world.OwnerUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, ScoreFor(result.Value!.TeamScores, world.TeamAId));
        Assert.Equal(1, ScoreFor(result.Value!.TeamScores, world.TeamBId));
    }

    [Fact]
    public void RetractedGoalsAreExcludedFromTheProjectedRunningScore()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();
        world.SeedGoal(world.TeamAId, 5);
        world.SeedRetractedGoal(world.TeamAId, 30);

        Result<GetRunningScoreResult> result = world.Read(world.ActiveMemberUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, ScoreFor(result.Value!.TeamScores, world.TeamAId));
        Assert.Equal(0, ScoreFor(result.Value!.TeamScores, world.TeamBId));
    }

    // ---- Non-member concealment (Requirement 11.3, 11.4) ------------------------------------------

    [Fact]
    public void ANonMemberReceivesTheUniformUnauthorizedDisclosingNoMatchData()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();
        world.SeedGoal(world.TeamAId, 5);

        Result<GetRunningScoreResult> result = world.Read(world.NonMemberUserId);

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
        // The failure discloses no match data — neither a result payload nor the squad/match identity.
        Assert.Null(result.Value);
    }

    [Fact]
    public void AnInactiveMembershipReceivesTheUniformUnauthorizedDisclosingNoMatchData()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();
        world.SeedGoal(world.TeamAId, 5);

        Result<GetRunningScoreResult> result = world.Read(world.InactiveMemberUserId);

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
        Assert.Null(result.Value);
    }

    [Fact]
    public void AMatchThatCannotBeFoundYieldsTheSameUniformUnauthorized()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();

        // An active member requesting a match id that does not resolve gets the identical failure a
        // non-member gets, so a rejection never discloses whether the match exists.
        Result<GetRunningScoreResult> result = world.ReadMatch(world.ActiveMemberUserId, Guid.NewGuid());

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
        Assert.Null(result.Value);
    }

    [Fact]
    public void ARequestWithNoAuthenticatedSubjectYieldsTheUniformUnauthorized()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();

        Result<GetRunningScoreResult> result = world.Read(Guid.Empty);

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
        Assert.Null(result.Value);
    }

    // ---- Empty-log zero scores (Requirement 6.4) --------------------------------------------------

    [Fact]
    public void AMatchWithNoEventsReportsEachTeamsRunningScoreAsZero()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();

        Result<GetRunningScoreResult> result = world.Read(world.ActiveMemberUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(world.Match.Teams.Count, result.Value!.TeamScores.Count);
        Assert.All(result.Value!.TeamScores, score => Assert.Equal(0, score.Score));
    }

    [Fact]
    public void ATeamWithNoEffectiveGoalsReportsZeroWhileTheOtherTeamScores()
    {
        GetRunningScoreWorld world = GetRunningScoreWorld.Build();
        // Only Team A scores; Team B has no effective goals and must report 0.
        world.SeedGoal(world.TeamAId, 8);
        world.SeedGoal(world.TeamAId, 55);

        Result<GetRunningScoreResult> result = world.Read(world.ActiveMemberUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, ScoreFor(result.Value!.TeamScores, world.TeamAId));
        Assert.Equal(0, ScoreFor(result.Value!.TeamScores, world.TeamBId));
    }

    private static int ScoreFor(IReadOnlyList<TeamScore> scores, Guid teamId) =>
        scores.Single(s => s.TeamId == teamId).Score;

    /// <summary>
    /// A hand-written, in-memory harness for <see cref="GetRunningScoreHandler"/>. It stages a single
    /// squad-scoped match walked through its genuine lifecycle to <see cref="MatchState.InProgress"/>
    /// (so the working teams are real), a membership set spanning an owner, an active plain member, and
    /// an inactive membership, and an append-only event store a test seeds the effective log into. The
    /// handler is assembled over the shared reusable fakes; the acting subject is set per read. No
    /// database and no mocking framework.
    /// </summary>
    internal sealed class GetRunningScoreWorld
    {
        private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);
        private static readonly DateTimeOffset MatchDay = Anchor.AddDays(7);

        private readonly GetRunningScoreHandler _handler;
        private readonly InMemoryMatchEventRepository _events;
        private readonly MutableCurrentUserAccessor _currentUser;

        private GetRunningScoreWorld(
            GetRunningScoreHandler handler,
            Match match,
            Guid squadId,
            InMemoryMatchEventRepository events,
            MutableCurrentUserAccessor currentUser,
            Guid ownerUserId,
            Guid activeMemberUserId,
            Guid inactiveMemberUserId,
            Guid teamAId,
            Guid teamBId)
        {
            _handler = handler;
            Match = match;
            SquadId = squadId;
            _events = events;
            _currentUser = currentUser;
            OwnerUserId = ownerUserId;
            ActiveMemberUserId = activeMemberUserId;
            InactiveMemberUserId = inactiveMemberUserId;
            TeamAId = teamAId;
            TeamBId = teamBId;
        }

        public Match Match { get; }

        public Guid SquadId { get; }

        /// <summary>The backing user id of the active owner (an active member, permitted to read).</summary>
        public Guid OwnerUserId { get; }

        /// <summary>The backing user id of an active plain member (permitted to read).</summary>
        public Guid ActiveMemberUserId { get; }

        /// <summary>The backing user id of a now-inactive membership (not permitted to read).</summary>
        public Guid InactiveMemberUserId { get; }

        /// <summary>A backing user id that holds no membership in the match's squad (not permitted).</summary>
        public Guid NonMemberUserId { get; } = Guid.NewGuid();

        /// <summary>The working <c>MatchTeam.Id</c> of the first team.</summary>
        public Guid TeamAId { get; }

        /// <summary>The working <c>MatchTeam.Id</c> of the second team.</summary>
        public Guid TeamBId { get; }

        /// <summary>Seeds one effective goal for <paramref name="scoringTeamId"/> at the given minute.</summary>
        public void SeedGoal(Guid scoringTeamId, int minute) =>
            _events.Seed(new GoalScoredEvent(
                Guid.CreateVersion7(), Match.Id, SquadId,
                MatchMinute.Create(minute).Value!, scoringTeamId, scorerMembershipId: null, ownGoal: false));

        /// <summary>
        /// Seeds a goal for <paramref name="scoringTeamId"/> that is immediately retracted, so it
        /// belongs to the log but not the effective set and must not change the running score.
        /// </summary>
        public void SeedRetractedGoal(Guid scoringTeamId, int minute)
        {
            var goal = new GoalScoredEvent(
                Guid.CreateVersion7(), Match.Id, SquadId,
                MatchMinute.Create(minute).Value!, scoringTeamId, scorerMembershipId: null, ownGoal: false);
            var retraction = new GoalRetractedEvent(
                Guid.CreateVersion7(), Match.Id, SquadId, MatchMinute.Create(minute).Value!, goal.Id);
            _events.Seed(goal, retraction);
        }

        /// <summary>Runs the handler as <paramref name="actingUserId"/> against the world's match.</summary>
        public Result<GetRunningScoreResult> Read(Guid actingUserId) =>
            ReadMatch(actingUserId, Match.Id);

        /// <summary>Runs the handler as <paramref name="actingUserId"/> against <paramref name="matchId"/>.</summary>
        public Result<GetRunningScoreResult> ReadMatch(Guid actingUserId, Guid matchId)
        {
            _currentUser.CurrentUserId = actingUserId == Guid.Empty ? null : actingUserId.ToString();
            return _handler
                .HandleAsync(new GetRunningScoreCommand(matchId), CancellationToken.None)
                .GetAwaiter()
                .GetResult();
        }

        /// <summary>
        /// Builds a world with a match walked to <see cref="MatchState.InProgress"/>. Ten participants
        /// are split into two teams of five (within the 5..8 lock rule), giving two genuine working
        /// teams for the running-score projection.
        /// </summary>
        public static GetRunningScoreWorld Build()
        {
            Squad squad = Squad.Create("The Squad").Value!;
            squad.SetFeature(SquadFeature.LiveMatchTracking, enabled: true);
            Guid squadId = squad.Id;

            var memberships = new List<SquadMembership>();

            Guid ownerUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;
            memberships.Add(owner);

            Guid activeMemberUserId = Guid.NewGuid();
            SquadMembership activeMember = SquadMembership.CreateRegistered(squadId, activeMemberUserId, "Member").Value!;
            memberships.Add(activeMember);

            Guid inactiveMemberUserId = Guid.NewGuid();
            SquadMembership inactiveMember = SquadMembership.CreateRegistered(squadId, inactiveMemberUserId, "Formerly Member").Value!;
            inactiveMember.Deactivate();
            memberships.Add(inactiveMember);

            const int playerCount = 10;
            const int teamASize = 5;
            var players = new List<SquadMembership>(playerCount);
            for (var i = 0; i < playerCount; i++)
            {
                players.Add(SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!);
            }

            Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, "Hackney Marshes", [MatchDay], Anchor).Value!;
            match.Confirm(MatchDay, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
            foreach (SquadMembership player in players)
            {
                match.AddParticipant(player);
            }

            var participantIds = players.Select(p => p.Id).ToList();
            var proposal = new List<ProposedTeam>
            {
                new("Reds", BibFlag: true, participantIds.Take(teamASize).ToList()),
                new("Blues", BibFlag: false, participantIds.Skip(teamASize).ToList()),
            };
            match.ApplyTeamProposal(proposal);
            match.Lock();
            match.Start();

            Guid teamAId = match.Teams.ElementAt(0).Id;
            Guid teamBId = match.Teams.ElementAt(1).Id;

            var events = new InMemoryMatchEventRepository();
            var matches = new SingleMatchRepository(match);
            var membershipRepository = new ConfiguredMembershipRepository(memberships);
            var currentUser = new MutableCurrentUserAccessor { CurrentUserId = ownerUserId.ToString() };

            var handler = new GetRunningScoreHandler(matches, membershipRepository, events, currentUser);

            return new GetRunningScoreWorld(
                handler, match, squadId, events, currentUser,
                ownerUserId, activeMemberUserId, inactiveMemberUserId, teamAId, teamBId);
        }
    }
}
